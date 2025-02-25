import type { FieldType } from 'n8n-workflow';
import type { IAutotaskField } from '../../../types/base/entities';
import type { IUdfFieldDefinition } from '../../../types/base/udf-types';
import { UdfDataType } from '../../../types/base/udf-types';
import type { OperationType } from '../../../operations/base/types';
import type { IBaseField, IReferenceField } from '../../../types/base/field-base';
import {
	isEnabledReferenceField,
	isNonEnabledReferenceField,
	isReferenceField,
	isResourceMapperField,
	isPicklistField,
	isUdfField,
	isBooleanField,
} from '../../../types/base/field-base';
import { FIELD_TYPE_MAPPINGS } from '../../../constants/field.constants';

/**
 * Context for field type mapping operations
 */
export interface IFieldMappingContext {
	/** Operation mode (read/write) */
	mode: 'read' | 'write';
	/** Current operation type */
	operation: OperationType;
	/** Entity type being processed */
	entityType: string;
	/** Whether mapping is for resource mapper */
	isResourceMapper?: boolean;
}

/**
 * Service for handling all field type mapping operations
 * Provides a single source of truth for converting between Autotask and n8n field types
 */
export class FieldTypeService {
	/**
	 * Map an Autotask field to its corresponding n8n field type
	 * Handles all special cases including reference fields, UDF fields, and boolean fields
	 */
	mapFieldType(
		field: IBaseField,
		context: IFieldMappingContext
	): FieldType {
		// For ResourceMapperField, use the type directly if available
		if (isResourceMapperField(field)) {
			return field.type as FieldType;
		}

		// Handle reference fields based on enabled status
		if (isReferenceField(field)) {
			return this.mapReferenceField(field, context);
		}

		// Handle UDF fields
		if (isUdfField(field)) {
			return this.mapUdfField(field, context);
		}

		// Handle boolean fields
		if (isBooleanField(field)) {
			return this.mapBooleanField(field, context);
		}

		// Handle standard fields
		return this.mapStandardField(field, context);
	}

	/**
	 * Map a reference field based on its enabled status and context
	 * @private
	 */
	private mapReferenceField(field: IReferenceField, context: IFieldMappingContext): FieldType {
		if (isEnabledReferenceField(field)) {
			return 'options';
		}
		if (isNonEnabledReferenceField(field)) {
			// Map non-enabled references based on their underlying data type
			return this.mapStandardField(field as unknown as IAutotaskField, context);
		}
		return 'string'; // Fallback for safety
	}

	/**
	 * Map a UDF field based on its data type and context
	 * @private
	 */
	private mapUdfField(field: IUdfFieldDefinition, context: IFieldMappingContext): FieldType {
		// Handle UDF picklists and List type fields
		if (field.isPickList || field.dataType === UdfDataType.List) {
			return 'options';
		}

		// Map UDF data types
		switch (field.dataType) {
			case UdfDataType.String:
				return 'string';
			case UdfDataType.Number:
				return 'number';
			case UdfDataType.DateTime:
				return 'dateTime';
			case UdfDataType.Boolean:
				return context.isResourceMapper ? 'options' : 'boolean';
			default:
				console.warn(`Unknown UDF data type ${field.dataType} for field ${field.name}, defaulting to string`);
				return 'string';
		}
	}

	/**
	 * Map a boolean field based on context
	 * In UI contexts (resource mapper), converts to options to prevent automatic inclusion
	 * @private
	 */
	private mapBooleanField(
		field: IBaseField,
		context: IFieldMappingContext
	): FieldType {
		// Convert to options in UI to prevent automatic inclusion with default values
		if (context.isResourceMapper) {
			return 'options';
		}
		return 'boolean';
	}

	/**
	 * Map a standard field based on its data type
	 * This is the single source of truth for all field type mapping
	 * @private
	 */
	private mapStandardField(
		field: IBaseField,
		context: IFieldMappingContext
	): FieldType {
		// For ResourceMapperField, use the type directly
		if (isResourceMapperField(field)) {
			return field.type as FieldType;
		}

		// Handle picklist fields first
		if (isPicklistField(field)) {
			return 'options';
		}

		// Get the field's data type
		const dataType = (field as IAutotaskField).dataType;
		const type = typeof dataType === 'string' ? dataType.toLowerCase() : 'string';

		// Use FIELD_TYPE_MAPPINGS for consistent mapping
		const mappedType = FIELD_TYPE_MAPPINGS.DEFAULT[type as keyof typeof FIELD_TYPE_MAPPINGS.DEFAULT];
		if (mappedType) {
			// Special handling for boolean fields in UI context
			if (mappedType === 'boolean' && context.isResourceMapper) {
				return 'options';
			}
			return mappedType as FieldType;
		}

		// Fallback to string for safety
		console.warn(`Unknown field type '${type}' for field '${field.name}', defaulting to string`);
		return 'string';
	}
}
