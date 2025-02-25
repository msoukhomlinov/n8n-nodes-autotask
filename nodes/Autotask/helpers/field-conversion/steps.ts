import type { ResourceMapperField } from '../../types/base/entities';
import type { ConversionStep, ConversionContext } from './types';
import { UdfDisplayFormat } from '../../types/base/udf-types';
import { DATE_FORMATS } from '../../constants/operations';
import { getFieldDisplayType, getResourceMapperFieldType, generateFieldOptions } from './utils';
import { getEntityMetadata } from '../../constants/entities';

/**
 * Field conversion steps
 */
export const conversionSteps: ConversionStep[] = [
	{
		name: 'validateField',
		handler: (context: ConversionContext): Partial<ResourceMapperField> | null => {
			// Fields are already filtered by FieldProcessor.filterFieldsByOperation
			// We only need to validate the field structure here
			if (!context.field.name) {
				console.debug('[ValidateField] Skipping field with no name');
				return null;
			}

			// Validate field has required properties
			if (!('dataType' in context.field) || !context.field.dataType) {
				console.debug(`[ValidateField] Field ${context.field.name} missing dataType property`);
				return null;
			}

			return {};
		},
	},
	{
		name: 'processBasicProperties',
		handler: (context: ConversionContext): Partial<ResourceMapperField> => {
			const metadata = getEntityMetadata(context.entityType);
			const parentIdField = metadata?.parentIdField || (metadata?.childOf ? `${metadata.childOf}ID` : undefined);

			try {
				// Use the centralized getResourceMapperFieldType for type mapping
				const type = getResourceMapperFieldType(context.field);
				if (!type) {
					throw new Error(`Failed to map type for field ${context.field.name}`);
				}

				const formattedLabel = context.fieldProcessor.getFieldLabel(context.field.name);
				const displayType = getFieldDisplayType(context.field);
				const displayName = `${formattedLabel} (${displayType} | ${context.field.name})`;

				// Check if this is a parent ID field
				const isParentIdField = Boolean(parentIdField && context.field.name.toLowerCase() === parentIdField.toLowerCase());
				if (isParentIdField) {
					console.debug(`[FieldConversion] ✓ Field ${context.field.name} is the parent ID field (${parentIdField})`);
				}

				// Set up the basic field properties
				const result: Partial<ResourceMapperField> = {
					id: context.field.name,
					displayName,
					type,
					// For read operations (like getMany), fields should not be required
					// For write operations, check if field is required based on multiple factors
					required: (() => {
						// Debug required field determination
						console.debug(
							`[FieldConversion] ${context.field.name} (${context.entityType}.${context.operation}): mode=${context.mode}, required=${context.field.isRequired}, readOnly=${context.field.isReadOnly}, isParentId=${isParentIdField}`
						);

						if (!context.operation || context.mode !== 'write') {
							return false;
						}

						const isCreateOperation = context.operation === 'create';
						const isUpdateOperation = context.operation === 'update';

						// For create operations, parent ID fields are always required
						if (isCreateOperation && isParentIdField) {
							return true;
						}

						// For update operations, only parent ID fields are required
						if (isUpdateOperation) {
							return isParentIdField;
						}

						// For create operations, check if field is required by definition
						return isCreateOperation && context.field.isRequired;
					})(),
					display: true, // Always show in UI by default
					defaultMatch: false,
				};

				// Only add canBeUsedToMatch if field is queryable and in read mode
				if (context.field.isQueryable && context.mode === 'read') {
					result.canBeUsedToMatch = true;
				}

				// Handle boolean fields - keep display true and defaultMatch false
				if (type === 'boolean') {
					result.display = true;
					result.defaultMatch = false;
				}

				// For parent ID fields in create operations, ensure they're not filtered out
				if (isParentIdField && context.operation === 'create') {
					result.display = true;
					result.defaultMatch = true;
				}

				return result;
			} catch (error) {
				throw new Error(`Failed to process basic properties for field ${context.field.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		},
	},
	{
		name: 'generateOptions',
		handler: (context: ConversionContext): Partial<ResourceMapperField> => {
			const options = generateFieldOptions(context.field);
			return options ? { options } : {};
		},
	},
	{
		name: 'handleDisplayFormat',
		handler: (context: ConversionContext): Partial<ResourceMapperField> => {
			const typeOptions: ResourceMapperField['typeOptions'] = {};

			// Handle date/time format
			if (context.field.dataType === 'dateTime' || context.field.dataType === 'date') {
				typeOptions.dateFormat = context.field.dataType === 'dateTime'
					? DATE_FORMATS.API_DATETIME
					: DATE_FORMATS.API_DATE;
				typeOptions.includeTime = context.field.dataType === 'dateTime';
			}

			// Handle display format if present
			if ('displayFormat' in context.field) {
				const displayFormat = context.field.displayFormat as number;

				if (displayFormat !== UdfDisplayFormat.Default) {
					switch (displayFormat) {
						case UdfDisplayFormat.Currency:
							typeOptions.numberPresentationMode = 'currency';
							break;
						case UdfDisplayFormat.Percentage:
							typeOptions.numberPresentationMode = 'percentage';
							break;
					}
				}
			}

			// Add decimal places if specified
			if ('numberOfDecimalPlaces' in context.field && typeof context.field.numberOfDecimalPlaces === 'number') {
				typeOptions.precision = context.field.numberOfDecimalPlaces;
			}

			return Object.keys(typeOptions).length ? { typeOptions } : {};
		},
	},
];
