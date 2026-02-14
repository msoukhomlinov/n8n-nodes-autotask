import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../types';
import type { IEntityField } from '../types/base/entities';
import type { IAutotaskField } from '../types/base/entity-types';
import type { IUdfFieldDefinition } from '../types/base/udf-types';
import { FilterOperators } from '../constants/filters';
import { getFields } from './entity/api';
import { getEntityMetadata } from '../constants/entities';
import type { ResourceOperation } from '../types/base/common';

/**
 * Get all processed fields for an entity
 * @param entityType
 * @param context
 * @returns A map of field names to field definitions
 */
export async function getProcessedFieldsMap(
	entityType: string,
	context: IExecuteFunctions,
): Promise<Map<string, IEntityField>> {
	// Check if entity supports UDFs
	const metadata = getEntityMetadata(entityType);
	const hasUdfs = metadata?.hasUserDefinedFields === true;

	// Get standard fields, and UDF fields only if supported
	const [standardApiFields, udfApiFields] = await Promise.all([
		getFields(entityType, context, { fieldType: 'standard' }),
		hasUdfs ? getFields(entityType, context, { fieldType: 'udf', isActive: true }) : Promise.resolve([]),
	]);

	// Combine all fields and create a map for easy lookup
	const fieldsMap = new Map<string, IEntityField>();

	// Add standard fields - convert them to IEntityField format
	for (const field of standardApiFields as IAutotaskField[]) {
		const entityField: IEntityField = {
			...field,
			isUdf: false,  // Standard fields are not UDF
		} as IEntityField;
		fieldsMap.set(field.name, entityField);
	}

	// Add UDF fields - convert them to IEntityField format and mark as UDF
	for (const field of udfApiFields as IUdfFieldDefinition[]) {
		const entityField: IEntityField = {
			...field,
			isUdf: true,  // UDF fields are marked as UDF
			isReference: false,  // UDF fields are not reference fields
			isSupportedWebhookField: field.isSupportedWebhookField || false,
		} as IEntityField;
		fieldsMap.set(field.name, entityField);
	}

	return fieldsMap;
}


/**
 * Type for field mappings from resource mapper
 */
interface IResourceMapperFields {
	value: { [key: string]: string | number };
}

/**
 * Get field mappings from resource mapper
 */
function getResourceMapperFields(context: IExecuteFunctions, itemIndex: number): IResourceMapperFields {
	return context.getNodeParameter('fieldsToMap', itemIndex) as IResourceMapperFields;
}

/**
 * Convert field mappings to filter format
 */
async function convertFieldsToFilters<T extends IAutotaskEntity>(
	fields: IResourceMapperFields,
	fieldsMap: Map<string, IEntityField>,
): Promise<IAutotaskQueryInput<T>['filter']> {
	const filters: IAutotaskQueryInput<T>['filter'] = [];

	if (fields?.value) {
		for (const [field, value] of Object.entries(fields.value)) {
			if (value !== undefined && value !== '') {
				const fieldDefinition = fieldsMap.get(field);
				const isUdf = fieldDefinition?.isUdf || false;

				filters.push({
					field,
					value,
					op: 'eq', // Use equals operator for field matching
					...(isUdf && { udf: true }),
				});
			}
		}
	}

	return filters;
}

/**
 * Finalize resource mapper filters by combining multiple fields with AND logic
 * If no filters exist, applies the default filter
 */
function finalizeResourceMapperFilters<T extends IAutotaskEntity>(
	filters: IAutotaskQueryInput<T>['filter'],
	defaultFilter?: { field: string; op: string },
): IAutotaskQueryInput<T>['filter'] {
	// If we have multiple filters, combine them with AND logic
	if (filters.length > 1) {
		return [{
			op: FilterOperators.and,
			items: filters,
		}];
	}

	// If we have exactly one filter, return it as is
	if (filters.length === 1) {
		return filters;
	}

	// No filters - use default filter
	if (defaultFilter) {
		return [defaultFilter];
	}

	// Fallback to id exists
	return [{
		field: 'id',
		op: FilterOperators.exist,
	}];
}

/**
 * Build filters array from resource mapper fields
 * Multiple fields are automatically combined with AND logic
 * Supports pre-built filters from AI tools via 'filtersFromTool' parameter
 */
export async function buildFiltersFromResourceMapper<T extends IAutotaskEntity>(
	context: IExecuteFunctions,
	itemIndex: number,
	entityType: string,
	operation: ResourceOperation,
	defaultFilter?: { field: string; op: string },
): Promise<IAutotaskQueryInput<T>['filter']> {
	// 'filtersFromTool' is injected by the AI tool executor at runtime and does
	// not exist in the node's property definitions. Newer n8n versions throw
	// from getNodeParameter even when a fallback is supplied if the parameter
	// name is absent from the schema, so we must guard with try/catch.
	try {
		const preBuilt = context.getNodeParameter('filtersFromTool', itemIndex, undefined) as
			| IAutotaskQueryInput<T>['filter']
			| undefined;
		if (Array.isArray(preBuilt) && preBuilt.length > 0) {
			return finalizeResourceMapperFilters<T>(preBuilt, defaultFilter);
		}
	} catch {
		// Parameter does not exist in the current execution context — expected
		// when running from the standard node UI rather than the AI tool path.
	}
	const fields = getResourceMapperFields(context, itemIndex);
	const fieldsMap = await getProcessedFieldsMap(entityType, context);
	const filters = await convertFieldsToFilters<T>(fields, fieldsMap);
	return finalizeResourceMapperFilters<T>(filters, defaultFilter);
}

/**
 * Build a filter query string from node parameters
 */
export async function buildFilterQuery<T extends IAutotaskEntity>(
	context: IExecuteFunctions,
	itemIndex: number,
	entityType: string,
	operation: ResourceOperation,
	defaultFilter?: { field: string; op: string },
): Promise<string> {
	const filters = await buildFiltersFromResourceMapper<T>(
		context,
		itemIndex,
		entityType,
		operation,
		defaultFilter,
	);
	return JSON.stringify({ filter: filters });
}
