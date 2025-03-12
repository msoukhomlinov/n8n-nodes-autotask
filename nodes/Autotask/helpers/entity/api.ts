import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskField } from '../../types/base/entities';
import type { IEntityInfo } from '../../types/base/entities';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import { UdfDataType } from '../../types/base/udf-types';
import type { IPicklistField } from '../../types/base/field-base';
import type { AutotaskDataType } from '../../types/base/core-types';
import type { ReferenceEnabledEntity } from '../../constants/field.constants';
import { autotaskApiRequest } from '../http';
import { initializeCache } from '../cache/init';
import pluralize from 'pluralize';

export type FieldType = 'standard' | 'udf';

interface IFieldOptions {
	fieldType?: FieldType;
	isActive?: boolean;
}

/**
 * Gets field definitions from the Autotask API
 * Handles both standard and UDF fields
 */
export async function getFields(
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	options: IFieldOptions = {},
): Promise<IAutotaskField[] | IUdfFieldDefinition[]> {
	const { fieldType = 'standard', isActive } = options;

	// Initialize cache service
	const cacheService = await initializeCache(context);

	// Try to get fields from cache first
	let fields: IDataObject[] | undefined;
	if (cacheService?.isEntityInfoEnabled()) {
		const cacheKey = cacheService.getFieldsKey(entityType, fieldType);
		fields = await cacheService.get<IDataObject[]>(cacheKey);
		console.debug(`[${new Date().toISOString()}] Cache ${fields ? 'hit' : 'miss'} for fields: ${entityType}.${fieldType}`);
	}

	// If not in cache, fetch from API
	if (!fields) {
		// Determine endpoint based on field type
		const endpoint = fieldType === 'udf'
			? `/${pluralize(entityType)}/entityInformation/userDefinedFields`
			: `/${pluralize(entityType)}/entityInformation/fields`;

		// Make API request
		const response = await autotaskApiRequest.call(
			context,
			'GET',
			endpoint,
		) as { fields: IDataObject[] };

		// Validate response
		if (!response?.fields || !Array.isArray(response.fields)) {
			throw new Error(`Failed to load ${fieldType} field information for ${entityType}: Invalid response format`);
		}

		fields = response.fields;

		// Cache the results if caching is enabled
		if (cacheService?.isEntityInfoEnabled()) {
			const cacheKey = cacheService.getFieldsKey(entityType, fieldType);
			await cacheService.set(
				cacheKey,
				fields,
				cacheService.getEntityInfoTTL(),
			);
		}
	}

	// Filter active fields if requested
	if (isActive !== undefined && fieldType === 'standard') {
		fields = fields.filter(field => field.isActive === isActive);
	}

	// Map fields based on type
	const mappedFields = fieldType === 'udf'
		? fields.map(field => mapUdfField(field))
		: fields.map(field => mapField(field));

	return mappedFields;
}

/**
 * Maps raw API response to standard field definition
 * @private
 */
function mapField(field: IDataObject): IAutotaskField {
	const isPickList = field.isPickList as boolean;
	const isReference = field.isReference as boolean;
	return {
		name: field.name as string,
		label: field.label as string,
		description: field.description as string | null,
		isRequired: field.isRequired as boolean,
		isReadOnly: field.isReadOnly as boolean,
		isActive: field.isActive as boolean,
		isQueryable: field.isQueryable as boolean,
		isSupportedWebhookField: field.isSupportedWebhookField as boolean,
		isSystemField: field.isSystemField as boolean,
		dataType: field.dataType as AutotaskDataType,
		length: field.length as number,
		isReference,
		referenceEntityType: isReference ? field.referenceEntityType as ReferenceEnabledEntity | string : undefined,
		isPickList,
		picklistValues: isPickList ? field.picklistValues as IPicklistField['picklistValues'] : undefined,
		picklistParentValueField: field.picklistParentValueField as string,
	};
}

/**
 * Maps raw API response to UDF field definition
 * @private
 */
function mapUdfField(field: IDataObject): IUdfFieldDefinition {
	const isPickList = field.isPickList as boolean;
	const picklistValues = isPickList && Array.isArray(field.picklistValues)
		? (field.picklistValues as IDataObject[])
			.filter(value => value.isActive as boolean ?? true)
			.map(value => ({
				value: value.value as string,
				label: value.label as string,
				isDefaultValue: value.isDefaultValue as boolean || false,
				sortOrder: value.sortOrder as number || 0,
				isActive: value.isActive as boolean || true,
				isSystem: value.isSystem as boolean || false,
			}))
		: undefined;

	// Determine data type based on API response
	let dataType = field.dataType as number;
	if (typeof dataType !== 'number') {
		// Convert string type to UdfDataType
		switch (field.type as string) {
			case 'string':
				dataType = UdfDataType.String;
				break;
			case 'number':
				dataType = UdfDataType.Number;
				break;
			case 'datetime':
				dataType = UdfDataType.DateTime;
				break;
			case 'boolean':
				dataType = UdfDataType.Boolean;
				break;
			case 'list':
				dataType = UdfDataType.List;
				break;
			default:
				console.warn(`Unknown field type ${field.type} for field ${field.name}, defaulting to String`);
				dataType = UdfDataType.String;
		}
	}

	// If field is a picklist, ensure it's marked as List type
	if (isPickList && dataType !== UdfDataType.List) {
		dataType = UdfDataType.List;
	}

	// Generate a stable ID based on name if not provided
	const id = field.id as number || Math.abs(hashCode(field.name as string));

	const result = {
		id,
		name: field.name as string,
		label: field.label as string,
		description: field.description as string || null,
		isRequired: field.isRequired as boolean,
		isReadOnly: field.isReadOnly as boolean,
		isActive: field.isActive as boolean || true,
		isQueryable: field.isQueryable as boolean || true,
		isSupportedWebhookField: field.isSupportedWebhookField as boolean,
		isSystemField: field.isSystemField as boolean || false,
		createDate: field.createDate as string || new Date().toISOString(),
		dataType,
		udfType: field.udfType as number || 1, // Default to Standard type
		displayFormat: field.displayFormat as number || 1, // Default to Default format
		isEncrypted: field.isEncrypted as boolean || false,
		isFieldMapping: field.isFieldMapping as boolean || false,
		isPrivate: field.isPrivate as boolean || false,
		isProtected: field.isProtected as boolean || false,
		isVisibleToClientPortal: field.isVisibleToClientPortal as boolean || true,
		numberOfDecimalPlaces: field.numberOfDecimalPlaces as number,
		sortOrder: field.sortOrder as number || 0,
		isPickList,
		picklistValues,
		crmToProjectUdfId: field.crmToProjectUdfId as number,
		defaultValue: field.defaultValue as string,
		mergeVariableName: field.mergeVariableName as string,
	};

	return result;
}

/**
 * Simple string hash function for generating stable IDs
 */
function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}

/**
 * Gets raw entity information from the API
 */
export async function getEntityInfo(
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
): Promise<IEntityInfo> {
	// Initialize cache service
	const cacheService = await initializeCache(context);

	// Try to get entity info from cache first
	let info: IEntityInfo | undefined;
	if (cacheService?.isEntityInfoEnabled()) {
		const cacheKey = cacheService.getEntityInfoKey(entityType);
		info = await cacheService.get<IEntityInfo>(cacheKey);
		console.debug(`[${new Date().toISOString()}] Cache ${info ? 'hit' : 'miss'} for entity info: ${entityType}`);
	}

	// If not in cache, fetch from API
	if (!info) {
		const endpoint = `/${pluralize(entityType)}/entityInformation`;
		const response = await autotaskApiRequest.call(
			context,
			'GET',
			endpoint,
		) as { info: IEntityInfo };

		if (!response?.info) {
			throw new Error(`Failed to load entity information for ${entityType}: Invalid response format`);
		}

		info = response.info;

		// Cache the results if caching is enabled
		if (cacheService?.isEntityInfoEnabled()) {
			const cacheKey = cacheService.getEntityInfoKey(entityType);
			await cacheService.set(
				cacheKey,
				info,
				cacheService.getEntityInfoTTL(),
			);
		}
	}

	return info;
}
