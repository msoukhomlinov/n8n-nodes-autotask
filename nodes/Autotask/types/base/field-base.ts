import type { INodePropertyOptions, FieldTypeMap } from 'n8n-workflow';
import { REFERENCE_ENABLED_ENTITIES } from '../../constants/field.constants';
import type { ReferenceEnabledEntity } from '../../constants/field.constants';
import type { AutotaskDataType } from './core-types';
import { UdfDataType } from './udf-types';
import type { IAutotaskField } from './entity-types';

/**
 * Base interface for all field types
 * Contains properties common to all fields
 */
export interface IBaseField {
	name: string;
	label: string;
	description: string | null;
	isRequired: boolean;
	isReadOnly: boolean;
	isActive: boolean;
	isQueryable: boolean;
	isSupportedWebhookField: boolean;
	isSystemField: boolean;
}

/**
 * Interface for fields that support picklist values
 */
export interface IPicklistField extends IBaseField {
	isPickList: true;
	picklistValues: Array<{
		value: string;
		label: string;
		isDefaultValue: boolean;
		sortOrder: number;
		isActive: boolean;
		isSystem: boolean;
		parentValue?: string;
		description?: string;
	}>;
	picklistParentValueField?: string;
}

/**
 * Interface for reference fields
 */
export interface IReferenceField extends IBaseField {
	isReference: true;
	referenceEntityType: ReferenceEnabledEntity | string;
	dataType: AutotaskDataType;
}

/**
 * Base interface for UDF fields
 */
export interface IUdfBaseField extends IBaseField {
	id: number;
	createDate: string;
	dataType: AutotaskDataType;
	udfType: number;
	displayFormat?: number;
	isEncrypted: boolean;
	isFieldMapping: boolean;
	isPrivate: boolean;
	isProtected: boolean;
	isVisibleToClientPortal: boolean;
	numberOfDecimalPlaces?: number;
	sortOrder: number;
}

/**
 * Interface for n8n resource mapper fields
 */
export interface IResourceMapperField extends IBaseField {
	id: string;
	displayName: string;
	required: boolean;
	type: keyof FieldTypeMap;
	options?: INodePropertyOptions[];
	display: boolean;
	typeOptions?: {
		dateFormat?: string;
		includeTime?: boolean;
		referenceEntityType?: string;
		loadOptionsDependsOn?: string[];
		loadOptionsMethod?: string;
		numberPresentationMode?: 'currency' | 'percentage';
		precision?: number;
		validation?: {
			min?: number;
			max?: number;
			pattern?: string;
			length?: number;
		};
	};
}

/**
 * Type guard to check if a field's dataType is a UDF type and optionally matches a specific type
 */
export function isUdfDataType(dataType: string | number, type?: UdfDataType): boolean {
	const isUdfType = typeof dataType === 'number';
	return type !== undefined ? isUdfType && dataType === type : isUdfType;
}

/**
 * Type guard to check if a field is a standard Autotask field
 */
export function isAutotaskField(field: IBaseField): field is IAutotaskField {
	return 'dataType' in field && !('udfType' in field);
}

/**
 * Type guard to check if a field is a picklist field
 */
export function isPicklistField(field: IBaseField): field is IPicklistField {
	return 'isPickList' in field && field.isPickList === true && 'picklistValues' in field;
}

/**
 * Type guard to check if a field is a reference field
 */
export function isReferenceField(field: IBaseField): field is IReferenceField {
	return 'isReference' in field && field.isReference === true && 'referenceEntityType' in field;
}

/**
 * Type guard to check if a field is a UDF field
 */
export function isUdfField(field: IBaseField): field is IUdfBaseField {
	return 'udfType' in field && 'dataType' in field;
}

/**
 * Type guard to check if a field is a resource mapper field
 */
export function isResourceMapperField(field: IBaseField): field is IResourceMapperField {
	return 'displayName' in field && 'type' in field && 'required' in field;
}

/**
 * Helper function to check if an entity type is enabled for reference lookups
 */
function isEnabledReferenceType(entityType: string | undefined): entityType is ReferenceEnabledEntity {
	return typeof entityType === 'string' && REFERENCE_ENABLED_ENTITIES.includes(entityType as ReferenceEnabledEntity);
}

/**
 * Type guard to check if a field is an enabled reference field
 * These are reference fields that can be used for lookups
 */
export function isEnabledReferenceField(field: IBaseField): field is IReferenceField {
	return isReferenceField(field) && isEnabledReferenceType(field.referenceEntityType);
}

/**
 * Type guard to check if a field is a non-enabled reference field
 * These are reference fields that cannot be used for lookups
 */
export function isNonEnabledReferenceField(field: IBaseField): field is IReferenceField {
	return isReferenceField(field) && !isEnabledReferenceType(field.referenceEntityType);
}

/**
 * Type guard to check if a field is a boolean field
 */
export function isBooleanField(field: IBaseField): boolean {
	if (isResourceMapperField(field)) {
		return field.type === 'boolean';
	}
	if (isUdfField(field)) {
		return isUdfDataType(field.dataType, UdfDataType.Boolean);
	}
	if (isAutotaskField(field)) {
		return field.dataType === 'boolean';
	}
	return false;
}

/**
 * Type guard to check if a field is a date/time field
 */
export function isDateField(field: IBaseField): boolean {
	if (isResourceMapperField(field)) {
		return field.type === 'dateTime';
	}
	if (isUdfField(field)) {
		return isUdfDataType(field.dataType, UdfDataType.DateTime);
	}
	if (isAutotaskField(field)) {
		return field.dataType === 'dateTime' || field.dataType === 'date';
	}
	return false;
}
