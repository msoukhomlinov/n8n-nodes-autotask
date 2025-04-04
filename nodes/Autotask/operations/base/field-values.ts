import type { IExecuteFunctions, IDataObject, GenericValue } from 'n8n-workflow';
import { FieldValidator } from './field-validator';
import { handleErrors } from '../../helpers/errorHandler';
import { getFields } from '../../helpers/entity/api';
import type { IAutotaskField } from '../../types/base/entity-types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import type { IFieldValidationRules } from '../../types/base/common';

interface SchemaField {
	id: string;
	displayName: string;
	type: string;
	required: boolean;
	display: boolean;
	defaultMatch: boolean;
	canBeUsedToMatch: boolean;
	removed: boolean;
}

/**
 * Gets field values from n8n node parameters for an operation
 * For create/update operations, includes all fields added to the UI (where removed=false in schema),
 * even if they have no value.
 */
export async function getOperationFieldValues(
	context: IExecuteFunctions,
	entityType: string,
	itemIndex: number,
	operation: 'create' | 'update' | 'getMany' | 'count',
): Promise<IDataObject> {
	try {
		// Get the raw parameter with schema information
		const fieldsToMap = context.getNodeParameter('fieldsToMap', itemIndex, {}) as {
			mappingMode: string;
			value: IDataObject | null | undefined;
			schema?: SchemaField[];
		};

		// For getMany operation, we need to get the selected fields
		if (operation === 'getMany' || operation === 'count') {
			const fields = fieldsToMap?.value ? Object.keys(fieldsToMap.value) : [];
			return { fields };
		}

		// For create/update operations
		const result: IDataObject = {};

		// Get all non-removed fields from the schema
		const activeFields = fieldsToMap.schema?.filter(field => !field.removed) || [];
		console.debug('[FieldValues] Active fields:', activeFields.map(f => f.id).join(', '));

		// Include all active fields in the result, handling case-insensitive matching
		for (const field of activeFields) {
			// Case-insensitive field lookup
			const matchingKey = Object.keys(fieldsToMap.value || {}).find(
				key => key.toLowerCase() === field.id.toLowerCase()
			);
			result[field.id] = matchingKey ? fieldsToMap.value?.[matchingKey] : '';
		}

		return result;
	} catch (error) {
		console.error('Error in getOperationFieldValues:', error);
		// During resource mapper initialization, the parameter might not exist yet
		return operation === 'getMany' ? { fields: [] } : {};
	}
}

/**
 * Validates and converts field values for an operation
 * Ensures date/time fields are properly converted from user timezone to UTC
 */
export async function validateFieldValues(
	context: IExecuteFunctions,
	entityType: string,
	rawValues: IDataObject,
	itemIndex: number,
	operation: 'create' | 'update',
): Promise<IDataObject> {
	return await handleErrors(context, async () => {
		// Create field validator instance
		const validator = new FieldValidator(entityType, context, operation);

		// Get entity field definitions
		const fields = await getFields(entityType, context) as IAutotaskField[];
		if (!fields || !fields.length) {
			throw new Error(
				ERROR_TEMPLATES.operation
					.replace('{type}', 'FieldError')
					.replace('{operation}', 'validateFieldValues')
					.replace('{entity}', entityType)
					.replace('{details}', 'Failed to get field definitions'),
			);
		}

		console.debug(`[validateFieldValues] Validating ${Object.keys(rawValues).length} field values for ${entityType}`);

		// Create validated result object
		const result: IDataObject = {};

		// Process each field in the raw values
		for (const [fieldName, value] of Object.entries(rawValues)) {
			// Find field definition (case-insensitive)
			const fieldDef = fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());

			if (!fieldDef) {
				console.warn(`[validateFieldValues] Field definition not found for ${fieldName}, skipping validation`);
				result[fieldName] = value;
				continue;
			}

			// Create validation rules from field definition
			const validationRules: IFieldValidationRules = {
				isRequired: fieldDef.isRequired ?? false,
				isReadOnly: fieldDef.isReadOnly ?? false,
				isQueryable: fieldDef.isQueryable ?? false,
				length: fieldDef.length,
			};

			// Type-cast field definition with validation rules
			// This bypasses the type incompatibility with different AutotaskDataType imports
			const fieldWithValidation = {
				...fieldDef,
				validation: validationRules,
			} as IAutotaskField & { validation: IFieldValidationRules };

			// Validate and convert field value
			const validated = await validator.validateField(fieldWithValidation, value);

			// Handle validation errors differently based on field type
			if (validated.error) {
				if (fieldDef.dataType === 'dateTime' || fieldDef.dataType === 'date') {
					// For date fields with validation errors, log a warning but include the original value
					// Our ensureDateFieldsConverted function will try to convert it as a fallback
					console.warn(`[validateFieldValues] Validation error for ${fieldName}: ${validated.error}`);
					console.debug(`[validateFieldValues] Will include original date value '${value}' for fallback conversion`);
					// Include the original value in the result so ensureDateFieldsConverted can try to convert it
					result[fieldName] = value;
					continue;
				}
				// For non-date fields, just log a warning and continue
				console.warn(`[validateFieldValues] Validation error for ${fieldName}: ${validated.error}`);
			}

			// Store the validated value, ensuring it's a valid IDataObject value
			if (validated.value !== undefined) {
				result[fieldName] = validated.value as IDataObject | GenericValue | GenericValue[] | IDataObject[];
			}
		}

		return result;
	});
}
