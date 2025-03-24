import type { ILoadOptionsFunctions, ResourceMapperFields, IExecuteFunctions, INodePropertyOptions } from 'n8n-workflow';
import { handleErrors } from '../errorHandler';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl } from './urls';
import { AutotaskWebhookEntityType } from '../../types/webhook';

/**
 * Interface for the structure of field information
 */
export interface IFieldDescription {
	displayName: string;
	description?: string;
	type: string;
	isRequired: boolean;
	isUdf?: boolean;
}

/**
 * Type guard to check if the context is IExecuteFunctions
 *
 * Note: When used in webhook creation, this should return false
 * to ensure we get a dictionary of fields instead of ResourceMapperFields format
 */
function isExecuteContext(context: ILoadOptionsFunctions | IExecuteFunctions): context is IExecuteFunctions {
	// More specific check to differentiate IExecuteFunctions from other contexts
	// We check specific properties/methods to determine the context

	// Special handling for webhook creation context
	// During webhook creation, context is cast from IHookFunctions to ILoadOptionsFunctions
	// We need to detect this and return false

	// Check if this is being called from webhook create method
	const isFromWebhookCreation =
		'getWorkflowStaticData' in context &&
		!('emit' in context); // IExecuteFunctions has emit, IHookFunctions doesn't

	if (isFromWebhookCreation) {
		return false;
	}

	// For regular usage, check methods/properties unique to IExecuteFunctions
	return 'getInputData' in context || 'emit' in context;
}

/**
 * Internal representation of a field
 */
interface IInternalField {
	id: string;
	displayName: string;
	description?: string;
	type: string;
	isRequired: boolean;
	isUdf?: boolean;
}

/**
 * Validates if the provided entity type is supported for webhooks
 * @param entityType The entity type to validate
 * @throws Error if the entity type is not supported
 */
function validateEntityType(entityType: string): void {
	const supportedTypes = Object.values(AutotaskWebhookEntityType);
	if (!supportedTypes.includes(entityType as AutotaskWebhookEntityType)) {
		throw new Error(`Unsupported entity type: ${entityType}. Supported types are: ${supportedTypes.join(', ')}`);
	}
}

/**
 * Get webhook-supported fields for an entity type
 * Returns only fields that support webhook operations (isSupportedWebhookField=true)
 *
 * @param entityType The Autotask entity type to get fields for
 * @returns ResourceMapperFields format or a record of field descriptions depending on context
 */
export async function getWebhookSupportedFields(
	this: ILoadOptionsFunctions | IExecuteFunctions,
	entityType: string,
): Promise<ResourceMapperFields | Record<string, IFieldDescription>> {
	return await handleErrors(this as unknown as IExecuteFunctions, async () => {
		// Check if entity type is empty and return empty result
		if (!entityType) {
			console.log('No entity type selected yet, returning empty fields');
			return isExecuteContext(this) ? { fields: [] } : {};
		}

		// Validate the entity type
		validateEntityType(entityType);

		// Internal collection of fields
		const internalFields: IInternalField[] = [];

		try {
			// Use webhook-specific endpoints directly to get available webhook fields
			console.log(`Fetching webhook field information for ${entityType} using webhook-specific endpoints`);

			// Get standard webhook fields first
			const response = await autotaskApiRequest.call(
				this,
				'GET',
				buildWebhookUrl(WebhookUrlType.WEBHOOK_FIELD_INFO, { entityType }),
			) as { fields?: Array<{ name: string; dataType: string; isRequired: boolean; isPickList: boolean; picklistValues?: Array<{ value: string; label: string }> }> };

			const fields = response.fields || [];

			// Find the fieldID field which contains picklist values for available webhook fields
			const fieldIdField = fields.find(f => f.name === 'fieldID');
			if (fieldIdField?.isPickList && fieldIdField?.picklistValues) {
				console.log(`Found ${fieldIdField.picklistValues.length} webhook-supported fields for ${entityType}`);

				// Use picklist values as our field list
				for (const field of fieldIdField.picklistValues) {
					internalFields.push({
						id: field.value, // This is the field ID as a string, will need to be converted to int when used
						displayName: field.label,
						description: 'Standard field available for webhooks',
						type: 'string', // Simplified type since we don't have detailed info
						isRequired: false,
						isUdf: false,
					});
				}
			} else {
				console.log(`No fieldID picklist found in webhook fields API for ${entityType}`);
			}

			// Now get UDF fields if available
			try {
				const udfResponse = await autotaskApiRequest.call(
					this,
					'GET',
					buildWebhookUrl(WebhookUrlType.WEBHOOK_UDF_FIELD_INFO, { entityType }),
				) as { fields?: Array<{ name: string; dataType: string; isRequired: boolean; isPickList: boolean; picklistValues?: Array<{ value: string; label: string }> }> };

				const udfFields = udfResponse.fields || [];

				// Find field containing picklist values for available UDF webhook fields
				// Try both 'udfFieldID' (newer API versions) and 'fieldID' (older API versions)
				let udfFieldIdField = udfFields.find(f => f.name === 'udfFieldID');
				if (!udfFieldIdField) {
					udfFieldIdField = udfFields.find(f => f.name === 'fieldID');
				}

				if (udfFieldIdField?.isPickList && udfFieldIdField?.picklistValues) {
					console.log(`Found ${udfFieldIdField.picklistValues.length} webhook-supported UDF fields for ${entityType}`);

					// Use picklist values as our UDF field list
					for (const field of udfFieldIdField.picklistValues) {
						internalFields.push({
							id: field.value, // This is the UDF field ID as a string
							displayName: field.label,
							description: 'User Defined Field available for webhooks',
							type: 'string', // Simplified type since we don't have detailed info
							isRequired: false,
							isUdf: true, // This is explicitly set based on the endpoint used, not field properties
						});
					}
				} else {
					console.log(`No UDF field picklist found in webhook UDF fields API for ${entityType}`);
				}
			} catch (udfError) {
				// Log detailed error for UDF fields
				console.log(`No UDF webhook fields available for ${entityType}: ${(udfError as Error).message}`);
			}
		} catch (error) {
			// If webhook field approach fails, provide a clear error
			console.error(`Failed to retrieve webhook fields for ${entityType}:`, error);
			throw new Error(`Failed to retrieve webhook fields for ${entityType}: ${(error as Error).message}`);
		}

		// If no fields were found, return an empty result based on context
		if (internalFields.length === 0) {
			console.log(`No webhook-supported fields found for ${entityType}`);
			return isExecuteContext(this) ? { fields: [] } : {};
		}

		// Now convert to the appropriate output format based on context
		if (isExecuteContext(this)) {
			// Return ResourceMapperFields format for IExecuteFunctions context
			return {
				fields: internalFields.map(field => ({
					id: field.id,
					displayName: field.displayName,
					description: field.description,
					type: field.type,
					required: field.isRequired,
					defaultMatch: false,
					display: true,
				})),
			} as ResourceMapperFields;
		}

		// Return dictionary format for ILoadOptionsFunctions context
		const fieldDict: Record<string, IFieldDescription> = {};
		for (const field of internalFields) {
			fieldDict[field.id] = {
				displayName: field.displayName,
				description: field.description,
				type: field.type,
				isRequired: field.isRequired,
				isUdf: field.isUdf,
			};
		}
		return fieldDict;
	});
}

/**
 * Format webhook fields for node UI display
 *
 * @param fields Record of field descriptions
 * @returns Array of options for UI display
 */
export function formatWebhookFieldsForDisplay(
	fields: Record<string, IFieldDescription>,
): INodePropertyOptions[] {
	const options: INodePropertyOptions[] = [];

	for (const [fieldId, fieldInfo] of Object.entries(fields)) {
		options.push({
			name: fieldInfo.isUdf ? `[UDF] ${fieldInfo.displayName}` : fieldInfo.displayName,
			value: fieldId,
			description: fieldInfo.description,
		});
	}

	// Sort options - standard fields first, then UDF fields, both alphabetically
	return options.sort((a, b) => {
		// Check if fields are UDF fields only by their isUdf property
		const aIsUdf = fields[a.value as string]?.isUdf === true;
		const bIsUdf = fields[b.value as string]?.isUdf === true;

		// If one is UDF and the other isn't, standard fields come first
		if (aIsUdf && !bIsUdf) return 1;
		if (!aIsUdf && bIsUdf) return -1;

		// If both are the same type, sort alphabetically
		return a.name.localeCompare(b.name);
	});
}
