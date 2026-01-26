import type { IAutotaskField } from '../../types/base/entity-types';
import type { IEntityValuePair } from '../../types/base/entity-values';
import type { EntityHelper } from '../entity/core';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';

type FieldType = IAutotaskField | IUdfFieldDefinition;

/**
 * Field mapping configuration for entity value retrieval
 */
export interface IFieldMapping {
	/** Fields to combine for display name */
	nameFields: string[];
	/** Field to use for value (defaults to 'id') */
	valueField?: string;
	/** Separator to use between name fields */
	separator?: string;
	/** Optional field to display in brackets */
	bracketField?: string;
}

/**
 * Validate and get field mapping configuration
 */
export async function getFieldMapping(
	entityType: string,
	entityHelper: EntityHelper,
	mapping: IFieldMapping | undefined,
): Promise<{
	nameFields: string[];
	valueField: string;
	separator: string;
	bracketField?: string;
}> {
	// Set default or provided mapping
	const nameFields = mapping?.nameFields || ['name'];
	const valueField = mapping?.valueField || 'id';
	const separator = mapping?.separator || ' ';
	const bracketField = mapping?.bracketField;

	// Validate fields exist
	const fields = await entityHelper.getFields();
	const availableFields = fields.map((f: FieldType) => f.name);

	// Validate all fields including bracketField
	const allFields = [...nameFields, valueField];
	if (bracketField) allFields.push(bracketField);

	for (const field of allFields) {
		if (!fields.some((f: FieldType) => f.name === field)) {
			throw new Error(`Required field '${field}' not found in entity '${entityType}'. Available fields: ${availableFields.join(', ')}`);
		}
	}

	return { nameFields, valueField, separator, bracketField };
}

/**
 * Get picklist values for fields
 */
export async function getPicklistValues(
	entityHelper: EntityHelper,
	fields: IAutotaskField[],
): Promise<{
	namePicklistValues: IEntityValuePair[][];
	valuePicklistValues: IEntityValuePair[];
}> {
	// Get picklist values for name fields
	const namePicklistValues = await Promise.all(
		fields.map(async field => {
			if (!field.isPickList) return [];

			const values = await entityHelper.getPicklistValues(field.name);
			return values.map(v => ({
				name: v.label,
				value: v.value,
				description: undefined,
				isDefaultValue: v.isDefaultValue,
				sortOrder: v.sortOrder,
				isActive: v.isActive,
				parentValue: v.parentValue,
			}));
		})
	);

	// Get picklist values for value field
	const valueField = fields[fields.length - 1];
	const valuePicklistValues = valueField.isPickList
		? (await entityHelper.getPicklistValues(valueField.name)).map(v => ({
			name: v.label,
			value: v.value,
			description: undefined,
			isDefaultValue: v.isDefaultValue,
			sortOrder: v.sortOrder,
			isActive: v.isActive,
			parentValue: v.parentValue,
		}))
		: [];

	return { namePicklistValues, valuePicklistValues };
}
