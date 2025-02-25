import type { INodePropertyOptions, NodePropertyTypes } from 'n8n-workflow';
import type { IAutotaskField, IEntityField, ResourceMapperField } from '../../types/base/entities';
import { isEnabledReferenceField, isNonEnabledReferenceField, isResourceMapperField } from '../../types/base/field-base';
import { FieldTypeService } from './services/field-type.service';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import { UdfDataType } from '../../types/base/udf-types';
import { OperationType } from '../../types/base/entity-types';
import type { IResourceMapperField } from '../../types/base/field-base';

// Create singleton instance of FieldTypeService
export const fieldTypeService = new FieldTypeService();

export function getFieldDescription(field: IAutotaskField): string {
	if (field.isReference) {
		return `Reference to ${field.referenceEntityType} entity`;
	}
	return (field as IEntityField).description || '';
}

/**
 * Sorts picklist values alphabetically by label, with sortOrder as secondary criteria
 * for stable sorting when labels are identical
 */
export function sortPicklistValues<T extends { label: string; sortOrder: number }>(values: T[]): T[] {
	return values.sort((a, b) => {
		const labelCompare = a.label.localeCompare(b.label);
		return labelCompare !== 0 ? labelCompare : a.sortOrder - b.sortOrder;
	});
}

/**
 * Maps picklist values to n8n options
 * Centralised function for handling all picklist and boolean option mapping
 */
export function mapFieldOptions(field: IAutotaskField | IResourceMapperField): INodePropertyOptions[] | undefined {
	// Handle resource mapper fields
	if (isResourceMapperField(field)) {
		return field.options;
	}

	// Handle picklist fields
	if (field.isPickList && Array.isArray(field.picklistValues)) {
		return sortPicklistValues(field.picklistValues.filter(value => value.isActive))
			.map(value => ({
				name: value.label,
				value: String(value.value),
				description: value.isDefaultValue ? 'Default value' : undefined,
			}));
	}

	// Handle boolean fields
	if (field.dataType === 'boolean') {
		return [
			{ name: 'Yes', value: 'true', description: 'True/Yes' },
			{ name: 'No', value: 'false', description: 'False/No' },
		];
	}

	return undefined;
}

/**
 * Gets type options for fields based on their type
 * Centralised function for handling all field type options
 */
export function getFieldTypeOptions(field: IAutotaskField | IResourceMapperField): ResourceMapperField['typeOptions'] | undefined {
	// Handle resource mapper fields
	if (isResourceMapperField(field)) {
		return field.type === 'dateTime' ? { includeTime: true } : undefined;
	}

	// Handle date/time fields
	if (field.dataType === 'dateTime' || field.dataType === 'date') {
		return {
			includeTime: field.dataType === 'dateTime',
		};
	}

	// Handle enabled reference fields
	if (isEnabledReferenceField(field)) {
		return {
			loadOptionsMethod: 'getReferenceValues',
			referenceEntityType: field.referenceEntityType,
		};
	}

	return undefined;
}

/**
 * Gets the human-readable field type for display in the UI
 */
export function getFieldDisplayType(field: IAutotaskField): string {
	// Handle reference fields based on enabled status
	if (isEnabledReferenceField(field)) {
		return `Reference: ${field.referenceEntityType}`;
	}
	if (isNonEnabledReferenceField(field)) {
		// For non-enabled references, show the underlying data type
		const rawType = field.dataType.toString();
		return rawType.charAt(0).toUpperCase() + rawType.slice(1);
	}

	// Handle picklists
	if (field.isPickList) {
		return 'Picklist';
	}

	// Capitalize first letter of dataType for other types
	const rawType = field.dataType.toString();
	return rawType.charAt(0).toUpperCase() + rawType.slice(1);
}

/**
 * Maps a UDF field type to n8n field type
 */
export function mapUdfFieldType(
	field: IUdfFieldDefinition,
	operation: OperationType,
	entityType: string,
	isResourceMapper = false,
): NodePropertyTypes {
	// For List type fields or picklists, always set dataType to 'options'
	if (field.dataType === UdfDataType.List || field.isPickList) {
		return 'options';
	}

	return fieldTypeService.mapFieldType(field, {
		mode: operation.startsWith('get') ? 'read' : 'write',
		operation,
		entityType,
		isResourceMapper,
	}) as NodePropertyTypes;
}

/**
 * Gets the field type for n8n resource mapper.
 * Uses the centralized FieldTypeService to ensure consistent type mapping.
 *
 * @param field - The Autotask field to map
 * @returns n8n field type or null
 */
export function getResourceMapperFieldType(field: IAutotaskField): ResourceMapperField['type'] | null {
	return fieldTypeService.mapFieldType(field, {
		mode: 'read',
		operation: OperationType.READ,
		entityType: field.referenceEntityType || 'unknown',
		isResourceMapper: true,
	}) as ResourceMapperField['type'];
}

/**
 * Generates options for picklist and boolean fields.
 * For boolean fields, provides consistent Yes/No options to replace default checkboxes.
 * This is part of our strategy to handle boolean fields as picklists to prevent
 * n8n from automatically including them with default false values.
 */
export function generateFieldOptions(field: IAutotaskField): INodePropertyOptions[] | undefined {
	// Handle picklist fields
	if (field.isPickList && Array.isArray(field.picklistValues)) {
		return sortPicklistValues(field.picklistValues.filter(value => value.isActive))
			.map((value) => ({
				name: value.label,
				value: String(value.value),
				description: value.isDefaultValue ? 'Default value' : '',
			}));
	}

	// Handle boolean fields with consistent Yes/No options
	// This replaces the default checkbox with a more explicit selection
	if (field.dataType === 'boolean') {
		return [
			{ name: 'Yes', value: 'true', description: 'True/Yes' },
			{ name: 'No', value: 'false', description: 'False/No' },
		];
	}

	return undefined;
}

export function generateTypeOptions(field: IAutotaskField): ResourceMapperField['typeOptions'] | undefined {
	if (field.dataType === 'dateTime' || field.dataType === 'date') {
		return {
			includeTime: field.dataType === 'dateTime',
		};
	}

	// Only enable dynamic loading for enabled reference fields
	if (isEnabledReferenceField(field)) {
		return {
			loadOptionsMethod: 'getReferenceValues',
			referenceEntityType: field.referenceEntityType,
		};
	}

	return undefined;
}
