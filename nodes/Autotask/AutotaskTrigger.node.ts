import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	NodeConnectionType,
	IHookFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { AutotaskWebhookEntityType, AutotaskWebhookEventType } from './types/webhook';
import type { IAutotaskWebhookPayload, IAutotaskRawWebhookPayload } from './types/webhook';
import { verifyWebhookSignature } from './helpers/webhook/signature';
import { autotaskApiRequest } from './helpers/http';
import type { IFieldDescription } from './helpers/webhook/fields';
import { getWebhookSupportedFields, formatWebhookFieldsForDisplay } from './helpers/webhook/fields';
import { getResourcesForExclusion, processBatchResources } from './helpers/webhook/resources';
import { WebhookUrlType, buildWebhookUrl } from './helpers/webhook/urls';
import { randomBytes } from 'node:crypto';
import { normalizeFieldId, processBatchFields } from './helpers/webhook/fieldConfiguration';

// Create a more specific interface for the ResourceMapperField
interface IWebhookResourceMapperField {
	id: string;
	displayName: string;
	type: string;
	required?: boolean;
	[key: string]: unknown;
}

/**
 * AutotaskTrigger is a node that handles webhook events from Autotask
 */
export class AutotaskTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autotask Trigger',
		name: 'autotaskTrigger',
		icon: 'file:autotask.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["entityType"] + ": " + ($parameter["eventTypes"].length > 0 ? $parameter["eventTypes"].join(", ") : "all events")}}',
		description: 'Handle Autotask Webhook events',
		defaults: {
			name: 'Autotask Trigger',
		},
		inputs: [],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [
			{
				name: 'autotaskApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
			{
				name: 'setup',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'deactivation',
			},
		],
		properties: [
			{
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'options',
				default: '',
				required: true,
				options: [
					{
						name: 'Companies',
						value: AutotaskWebhookEntityType.COMPANIES,
						description: 'Handle Company webhook events',
					},
					{
						name: 'Contacts',
						value: AutotaskWebhookEntityType.CONTACTS,
						description: 'Handle Contacts webhook events',
					},
					{
						name: 'Tickets',
						value: AutotaskWebhookEntityType.TICKETS,
						description: 'Handle Tickets webhook events',
					},
					{
						name: 'Configuration Items',
						value: AutotaskWebhookEntityType.CONFIGURATIONITEMS,
						description: 'Handle Configuration Items webhook events',
					},
					{
						name: 'Ticket Notes',
						value: AutotaskWebhookEntityType.TICKETNOTES,
						description: 'Handle Ticket Notes webhook events',
					},
				],
				description: 'The type of entity to trigger on',
			},
			{
				displayName: 'Event Types',
				name: 'eventTypes',
				type: 'multiOptions',
				default: ['create', 'update', 'delete'],
				required: true,
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'When a record is created',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'When a record is updated',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'When a record is deleted',
					},
				],
				description: 'The event types to trigger on. Select at least one.',
			},
			{
				displayName: 'Notification Email Address',
				name: 'notificationEmailAddress',
				type: 'string',
				default: '',
				placeholder: 'name@email.com',
				description: 'Optional. Email address to receive notifications about webhook delivery failures.',
			},
			{
				displayName: 'Send Threshold Notifications',
				name: 'sendThresholdNotifications',
				type: 'boolean',
				default: false,
				description: 'Whether to receive notifications when webhook delivery thresholds are exceeded. Requires a notification email address. If no email address is provided, this setting will be ignored.',
				hint: 'Sends emails to the notification email address when webhook requests exceed the hourly threshold and when they return to normal. Will be disabled automatically if no notification email is provided.',
			},
			{
				displayName: 'No Fields Available',
				name: 'noFieldsMessage',
				type: 'notice',
				default: '',
				description: 'This entity type does not support field selection. All available fields will be included in webhook payloads.',
				displayOptions: {
					show: {
						entityType: [
							AutotaskWebhookEntityType.TICKETNOTES,
							AutotaskWebhookEntityType.TICKETS,
						],
					},
				},
			},
			{
				displayName: 'Subscribed Field Names or IDs',
				name: 'subscribedFields',
				type: 'multiOptions',
				default: [],
				description: 'Fields to subscribe to receive updates from. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsMethod: 'getWebhookFields',
					loadOptionsDependsOn: ['entityType'],
				},
				displayOptions: {
					show: {
						entityType: [
							AutotaskWebhookEntityType.COMPANIES,
							AutotaskWebhookEntityType.CONTACTS,
							AutotaskWebhookEntityType.CONFIGURATIONITEMS,
						],
					},
				},
			},
			{
				displayName: 'Always Display Field Names or IDs',
				name: 'displayAlwaysFields',
				type: 'multiOptions',
				default: [],
				description: 'Fields to always include in webhook payloads. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsMethod: 'getWebhookFields',
					loadOptionsDependsOn: ['entityType'],
				},
				displayOptions: {
					show: {
						entityType: [
							AutotaskWebhookEntityType.COMPANIES,
							AutotaskWebhookEntityType.CONTACTS,
							AutotaskWebhookEntityType.CONFIGURATIONITEMS,
						],
					},
				},
			},
			{
				displayName: 'Excluded Resources Names or IDs',
				name: 'excludedResources',
				type: 'multiOptions',
				default: [],
				description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getResources',
					loadOptionsDependsOn: ['entityType'],
				},
				displayOptions: {
					show: {
						entityType: [
							AutotaskWebhookEntityType.COMPANIES,
							AutotaskWebhookEntityType.CONTACTS,
							AutotaskWebhookEntityType.TICKETS,
							AutotaskWebhookEntityType.CONFIGURATIONITEMS,
							AutotaskWebhookEntityType.TICKETNOTES,
						],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			// Load webhook-supported fields for the selected entity type
			async getWebhookFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entityType = this.getNodeParameter('entityType') as string;
				try {
					const fields = await getWebhookSupportedFields.call(this, entityType);

					// If the result is already an array of options, return it
					if (Array.isArray(fields)) {
						// Check if fields array is empty
						if (fields.length === 0) {
							console.log(`No webhook-supported fields found for entity type: ${entityType}`);
							return [{
								name: 'Entity Does Not Support Field Selection, All Fields Selected',
								value: '__ALL_FIELDS__',
								description: 'This entity type does not support field selection',
							}];
						}
						return fields as INodePropertyOptions[];
					}

					// Otherwise, format the key-value object into options
					if ('fields' in fields && Array.isArray(fields.fields)) {
						// Handle ResourceMapperFields format
						const formattedFields = fields.fields.map((field) => {
							// Safe type casting
							const fieldData = field as unknown as {
								displayName: string;
								id: string;
								description?: string;
							};

							return {
								name: fieldData.displayName,
								value: fieldData.id,
								description: fieldData.description,
							};
						});

						// Check if formatted fields array is empty
						if (formattedFields.length === 0) {
							console.log(`No webhook-supported fields found for entity type: ${entityType}`);
							return [{
								name: 'Entity Does Not Support Field Selection, All Fields Selected',
								value: '__ALL_FIELDS__',
								description: 'This entity type does not support field selection',
							}];
						}

						return formattedFields;
					}

					// Handle dictionary format
					const formattedFields = formatWebhookFieldsForDisplay(fields as Record<string, IFieldDescription>);

					// Check if the formatted fields array is empty
					if (formattedFields.length === 0) {
						console.log(`No webhook-supported fields found for entity type: ${entityType}`);
						return [{
							name: 'Entity Does Not Support Field Selection, All Fields Selected',
							value: '__ALL_FIELDS__',
							description: 'This entity type does not support field selection',
						}];
					}

					return formattedFields;
				} catch (error) {
					console.error('Error loading webhook fields:', error);
					return [{
						name: 'Error Loading Fields, Please Check Logs',
						value: '__ERROR__',
						description: (error as Error).message,
					}];
				}
			},

			// Load resources (users) that can be excluded from webhook triggers
			async getResources(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const resources = await getResourcesForExclusion.call(this);

					return resources.map(resource => ({
						name: resource.name,
						value: resource.id,
					}));
				} catch (error) {
					console.error('Error loading resources:', error);
					return [];
				}
			},
		},
	};

	// Add webhookMethods to handle webhook registration
	webhookMethods = {
		default: {
			/**
			 * Check if a webhook already exists in Autotask
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				try {
					console.log('Checking if Autotask webhook already exists...');

					// Get the webhook ID from static data
					const webhookData = this.getWorkflowStaticData('node');
					const webhookId = webhookData.webhookId;

					// If no webhook ID is stored, webhook doesn't exist
					if (!webhookId) {
						console.log('No webhook ID found in workflow static data');
						return false;
					}

					const entityType = this.getNodeParameter('entityType') as string;
					console.log(`Checking webhook ID: ${webhookId} for entity type: ${entityType}`);

					// Try to retrieve the webhook from Autotask
					try {
						await autotaskApiRequest.call(
							this,
							'GET',
							buildWebhookUrl(WebhookUrlType.WEBHOOK_SPECIFIC, {
								entityType,
								id: webhookId as string | number
							}),
							{},
						);

						console.log(`Webhook ID: ${webhookId} exists in Autotask`);
						return true;
					} catch (error) {
						// If we get a 404, the webhook doesn't exist
						if ((error as Error).message.includes('404')) {
							console.log(`Webhook ID: ${webhookId} not found in Autotask`);
							// Clear the webhook ID from static data
							webhookData.webhookId = undefined;
							return false;
						}

						// For other errors, re-throw
						throw error;
					}
				} catch (error) {
					console.error('Error checking webhook existence:', error);
					// If checking fails, assume webhook doesn't exist for safety
					return false;
				}
			},

			/**
			 * Create a webhook in Autotask when a workflow is activated
			 */
			async create(this: IHookFunctions): Promise<boolean> {
				try {
					console.log('Creating Autotask webhook...');

					const webhookUrl = this.getNodeWebhookUrl('default');
					const deactivationUrl = this.getNodeWebhookUrl('setup');
					const entityType = this.getNodeParameter('entityType') as string;
					const eventTypes = this.getNodeParameter('eventTypes', []) as string[];
					const notificationEmailAddress = this.getNodeParameter('notificationEmailAddress', '') as string;
					const sendThresholdNotifications = this.getNodeParameter('sendThresholdNotifications', false) as boolean;

					// Always generate a strong secret key (32-character hexadecimal string)
					const secretKey = randomBytes(16).toString('hex');

					// Validate that at least one event type is selected
					if (eventTypes.length === 0) {
						throw new NodeOperationError(this.getNode(), 'At least one event type must be selected.');
					}

					// Generate a unique webhook name
					const workflowId = this.getWorkflow().id?.slice(0, 8) || randomBytes(4).toString('hex');
					const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');

					// Create abbreviations for event types (c=create, u=update, d=delete)
					const eventTypeMap: Record<string, string> = {
						'create': 'c',
						'update': 'u',
						'delete': 'd',
					};
					const eventTypeCode = eventTypes.map(type => eventTypeMap[type] || type.charAt(0)).join('');

					// Format: n8n-{entityType}-{eventTypesAbbreviated}-{workflowId}-{timestamp}
					const webhookName = `n8n-${entityType}-${eventTypeCode}-${workflowId}-${timestamp}`;

					// For entities that don't support field selection (like TicketNotes), we don't show field selection UI
					// and shouldn't try to get or process fields
					const isEntityWithoutFieldSupport = entityType === AutotaskWebhookEntityType.TICKETNOTES ||
						entityType === AutotaskWebhookEntityType.TICKETS;

					// Only get fields for inclusion if the entity supports field selection
					let subscribedFields: string[] = [];
					let displayAlwaysFields: string[] = [];

					if (!isEntityWithoutFieldSupport) {
						subscribedFields = this.getNodeParameter('subscribedFields', []) as string[];
						displayAlwaysFields = this.getNodeParameter('displayAlwaysFields', []) as string[];
					}

					// Get excluded resources
					const excludedResourceIds = this.getNodeParameter('excludedResources', []) as number[];

					// Construct the webhook data
					const webhookData: IDataObject = {
						name: webhookName,
						webhookUrl: webhookUrl,
						deactivationUrl,
						isActive: true,
						entityType,
						secretKey,
						// Set event subscription flags based on selected event types
						isSubscribedToCreateEvents: eventTypes.includes('create'),
						isSubscribedToUpdateEvents: eventTypes.includes('update'),
						isSubscribedToDeleteEvents: eventTypes.includes('delete'),
					};

					// Add notification email if provided
					if (notificationEmailAddress) {
						webhookData.notificationEmailAddress = notificationEmailAddress;
						// Only set threshold notifications if email is provided
						webhookData.sendThresholdExceededNotification = sendThresholdNotifications;
					} else {
						// Always set to false if no email is provided
						webhookData.sendThresholdExceededNotification = false;

						// If user enabled threshold notifications but didn't provide an email, log a warning
						if (sendThresholdNotifications) {
							console.warn('Threshold notifications enabled but no notification email provided. Threshold notifications will be disabled.');
						}
					}

					// Create the webhook in Autotask
					const response = await autotaskApiRequest.call(
						this,
						'POST',
						buildWebhookUrl(WebhookUrlType.WEBHOOK_BASE, { entityType }),
						webhookData,
					) as { item?: { id?: string | number; itemId?: string | number } };

					// Store the webhook ID for later deletion - check both id and itemId fields
					const webhookId = response.item?.id || response.item?.itemId;
					if (!webhookId) {
						throw new NodeOperationError(this.getNode(), 'Failed to create webhook - no ID returned');
					}
					console.log(`Webhook created with ID: ${webhookId}`);

					// Save the webhook ID in the node's metadata
					const webhookStaticData = this.getWorkflowStaticData('node');
					webhookStaticData.webhookId = webhookId as string;
					// Also store the secret key for future webhook validation
					webhookStaticData.secretKey = secretKey;

					// If webhook was successfully created and we have selected fields, add them
					if (webhookId && (subscribedFields.length > 0 || displayAlwaysFields.length > 0) && !isEntityWithoutFieldSupport) {
						// Get field metadata to determine if each field is standard or UDF
						const fieldMetadata = await getWebhookSupportedFields.call(
							this as unknown as ILoadOptionsFunctions,
							entityType
						);

						// Skip field processing if no field metadata was found
						if (!fieldMetadata || Object.keys(fieldMetadata).length === 0) {
							console.log('No field metadata found. Skipping field processing.');
						} else {
							// Determine the structure of the returned field metadata
							const isResourceMapperFormat = 'fields' in fieldMetadata && Array.isArray(fieldMetadata.fields);

							// Convert to dictionary format if needed
							let fieldDictionary: Record<string, IFieldDescription>;

							if (isResourceMapperFormat) {
								// Cast with a more specific type for the fields
								const resourceMapperFields = fieldMetadata as ResourceMapperFields;
								const fields = resourceMapperFields.fields || [];

								fieldDictionary = {};

								// Simplify conversion to avoid type errors
								for (const field of fields) {
									// Use our custom interface to safely access fields
									const typedField = field as unknown as IWebhookResourceMapperField;
									fieldDictionary[typedField.id] = {
										displayName: typedField.displayName || 'Unknown Field',
										description: '', // Use empty string to avoid type errors
										type: typedField.type || 'string',
										isRequired: Boolean(typedField.required),
										isUdf: Boolean(typedField.id?.toString().includes('udf')),
									};
								}
							} else {
								fieldDictionary = fieldMetadata as Record<string, IFieldDescription>;
							}

							// Process and normalize webhook fields using the new helper functions
							const allFieldConfigurations: Array<{ fieldId: number; isDisplayAlwaysField: boolean; isUdf: boolean }> = [];

							// Process all subscribedFields
							for (const fieldId of subscribedFields) {
								// Skip special placeholder values
								if (fieldId === '__ALL_FIELDS__') continue;

								try {
									// Normalize field ID
									const normalizedFieldId = normalizeFieldId(fieldId);

									// Lookup field metadata
									const fieldInfo = fieldDictionary[fieldId] || fieldDictionary[normalizedFieldId.toString()];

									if (!fieldInfo) {
										console.warn(`Field info not found for field ID: ${fieldId}. Skipping this field.`);
										continue;
									}

									// Add to the unified configuration array
									allFieldConfigurations.push({
										fieldId: normalizedFieldId,
										isDisplayAlwaysField: false, // subscribedFields have isSubscribedField=true
										isUdf: Boolean(fieldInfo.isUdf),
									});
								} catch (error) {
									console.error(`Error processing field ID ${fieldId}: ${(error as Error).message}`);
								}
							}

							// Process displayAlwaysFields (only those not already in subscribedFields)
							for (const fieldId of displayAlwaysFields) {
								// Skip special placeholder values and already processed fields
								if (fieldId === '__ALL_FIELDS__' || subscribedFields.includes(fieldId)) continue;

								try {
									// Normalize field ID
									const normalizedFieldId = normalizeFieldId(fieldId);

									// Lookup field metadata
									const fieldInfo = fieldDictionary[fieldId] || fieldDictionary[normalizedFieldId.toString()];

									if (!fieldInfo) {
										console.warn(`Field info not found for field ID: ${fieldId}. Skipping this field.`);
										continue;
									}

									// Add to the unified configuration array
									allFieldConfigurations.push({
										fieldId: normalizedFieldId,
										isDisplayAlwaysField: true, // displayAlwaysFields have isDisplayAlwaysField=true
										isUdf: Boolean(fieldInfo.isUdf),
									});
								} catch (error) {
									console.error(`Error processing field ID ${fieldId}: ${(error as Error).message}`);
								}
							}

							console.log(`Processing ${allFieldConfigurations.length} fields for webhook...`);

							// Process fields in batch for efficiency
							if (allFieldConfigurations.length > 0) {
								// Group by UDF status for better logging
								const standardFields = allFieldConfigurations.filter(f => !f.isUdf);
								const udfFields = allFieldConfigurations.filter(f => f.isUdf);

								// Process standard fields
								if (standardFields.length > 0) {
									const standardResults = await processBatchFields(
										this,
										standardFields,
										{ entityType, webhookId },
										{ concurrencyLimit: 10 }
									);

									if (standardResults.failed > 0) {
										console.warn(`Failed to add ${standardResults.failed} standard fields`);
									}
								}

								// Process UDF fields
								if (udfFields.length > 0) {
									const udfResults = await processBatchFields(
										this,
										udfFields,
										{ entityType, webhookId },
										{ concurrencyLimit: 10 }
									);

									if (udfResults.failed > 0) {
										console.warn(`Failed to add ${udfResults.failed} UDF fields`);
									}
								}
							}
						}
					}

					// Add excluded resources to the webhook if specified
					if (excludedResourceIds.length > 0) {
						console.log(`Processing ${excludedResourceIds.length} excluded resources...`);

						// Process resources in batches
						const resourceResults = await processBatchResources(
							this,
							excludedResourceIds,
							{ entityType, webhookId },
							{ concurrencyLimit: 10, batchSize: 20 }
						);

						if (resourceResults.failed > 0) {
							console.warn(`Failed to exclude ${resourceResults.failed} resources`);
						}
					}

					console.log('Autotask webhook created successfully');
					return true;
				} catch (error) {
					console.error('Webhook creation failed with error:', error);
					throw new NodeOperationError(
						this.getNode(),
						`Error creating webhook: ${(error as Error).message}`,
					);
				}
			},

			/**
			 * Delete the webhook from Autotask when a workflow is deactivated
			 */
			async delete(this: IHookFunctions): Promise<boolean> {
				try {
					console.log('Deleting Autotask webhook...');
					const entityType = this.getNodeParameter('entityType') as string;

					// Get the webhook ID from the node's metadata
					const webhookData = this.getWorkflowStaticData('node');
					const webhookId = webhookData.webhookId;

					if (!webhookId) {
						console.log('No webhook ID found. Webhook may have been deleted already.');
						// If no webhook ID is found, it might have been deleted already
						return true;
					}

					// Delete the webhook from Autotask
					await autotaskApiRequest.call(
						this,
						'DELETE',
						buildWebhookUrl(WebhookUrlType.WEBHOOK_SPECIFIC, {
							entityType,
							id: webhookId as string | number
						}),
						{},
					);

					console.log(`Webhook ID: ${webhookId} deleted successfully`);

					// Clear the webhook ID from the node's metadata
					webhookData.webhookId = undefined;

					return true;
				} catch (error) {
					console.error('Webhook deletion error:', error);

					// If we get a 404, the webhook may already be deleted
					if ((error as Error).message.includes('404')) {
						console.log('Webhook not found (404). It may have been deleted already.');
						const webhookData = this.getWorkflowStaticData('node');
						webhookData.webhookId = undefined;
						return true;
					}

					// If we get a 500 with "No matching records found", the webhook may already be deleted
					if ((error as Error).message.includes('500') &&
						(error as Error).message.includes('No matching records found')) {
						console.log('Webhook not found (500 with "No matching records found"). It may have been deleted already.');
						const webhookData = this.getWorkflowStaticData('node');
						webhookData.webhookId = undefined;
						return true;
					}

					throw new NodeOperationError(
						this.getNode(),
						`Error deleting webhook: ${(error as Error).message}`,
					);
				}
			},
		},
	};

	/**
	 * Webhook callback handler (incoming webhook request)
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		console.log('Webhook event received from Autotask');

		const headerData = this.getHeaderData();
		const rawBodyData = this.getBodyData() as IAutotaskRawWebhookPayload;
		const entityType = this.getNodeParameter('entityType') as string;
		const eventTypes = this.getNodeParameter('eventTypes', []) as string[];

		// Get the secret key from workflow static data instead of node parameters
		const webhookData = this.getWorkflowStaticData('node');
		const secretKey = webhookData.secretKey as string;

		// Map Autotask webhook payload to our expected format
		// Autotask sends: Action, Guid, EntityType, Id, Fields, EventTime, SequenceNumber, PersonID
		// We expect: eventType, entityType, entityId, entityData, timestamp, webhookId
		const bodyData: IAutotaskWebhookPayload = {
			eventType: rawBodyData.Action as AutotaskWebhookEventType,
			entityType: rawBodyData.EntityType as AutotaskWebhookEntityType,
			entityId: rawBodyData.Id,
			entityData: rawBodyData.Fields || {},
			timestamp: rawBodyData.EventTime,
			webhookId: 0, // Not provided in the raw payload
		};

		console.log(`Webhook event details: entityType=${bodyData.entityType}, eventType=${bodyData.eventType}, entityId=${bodyData.entityId}`);

		// Special handling for Deactivated events - these don't have an entityType
		if (bodyData.eventType === AutotaskWebhookEventType.DEACTIVATED ||
			(bodyData.eventType as string) === 'Deactivated') {
			console.log('Received webhook deactivation event. Processing without validation.');

			// Clear webhook ID from static data to prevent further deletion attempts
			if (webhookData.webhookId) {
				console.log(`Clearing webhook ID ${webhookData.webhookId} from static data due to deactivation event`);
				webhookData.webhookId = undefined;
			}

			// Return success response for deactivation event
			return {
				workflowData: [
					this.helpers.returnJsonArray([
						{
							headers: headerData,
							body: rawBodyData,
							eventType: bodyData.eventType,
							deactivated: true,
							guid: rawBodyData.Guid,
							timestamp: bodyData.timestamp,
						},
					]),
				],
			};
		}

		// Validate content type - accept application/json with any parameters
		const contentType = headerData['content-type'] as string;
		if (!contentType || !contentType.includes('application/json')) {
			console.error(`Invalid content type received: ${contentType}. Expected application/json.`);
			throw new NodeOperationError(
				this.getNode(),
				'Invalid content type. Expected application/json.',
			);
		}

		// Map of Autotask API entity types to our node's entity types (aliases)
		const entityTypeAliases: Record<string, string> = {
			'Account': AutotaskWebhookEntityType.COMPANIES, // Autotask uses "Account" and "Companies" interchangeably
		};

		// Get the normalized entity type from the incoming payload
		let normalizedEntityType = (bodyData.entityType as string)?.toLowerCase();

		// Check for aliases and normalize them
		const receivedEntityType = bodyData.entityType as string;
		if (entityTypeAliases[receivedEntityType]) {
			console.log(`Mapping entity type alias: ${receivedEntityType} → ${entityTypeAliases[receivedEntityType]}`);
			normalizedEntityType = entityTypeAliases[receivedEntityType].toLowerCase();
		}

		// Validate entity type - allow for case-insensitive comparison with aliases
		if (entityType.toLowerCase() !== normalizedEntityType) {
			console.error(`Entity type mismatch: received ${bodyData.entityType} (normalized to ${normalizedEntityType}), expected ${entityType}`);
			throw new NodeOperationError(
				this.getNode(),
				`Invalid entity type. Received ${bodyData.entityType}, expected ${entityType}.`,
			);
		}

		// Map the lower-case event type back to Autotask enum values for comparison
		const eventTypeMapping: Record<string, AutotaskWebhookEventType> = {
			'create': AutotaskWebhookEventType.CREATE,
			'update': AutotaskWebhookEventType.UPDATE,
			'delete': AutotaskWebhookEventType.DELETE,
		};

		// Convert selected event types to Autotask enum values
		const mappedEventTypes = eventTypes.map(type => eventTypeMapping[type]);

		// Validate event type against selected event types - allow for case-insensitive comparison
		if (eventTypes.length > 0 && !mappedEventTypes.includes(bodyData.eventType)) {
			console.error(`Event type mismatch: received ${bodyData.eventType}, expected one of: ${eventTypes.join(', ')}`);
			throw new NodeOperationError(
				this.getNode(),
				`Invalid event type. Received ${bodyData.eventType}, expected one of: ${eventTypes.join(', ')}.`,
			);
		}

		// Verify the webhook payload using the secret key
		if (secretKey) {
			console.log('Verifying webhook signature with secret key');

			// Look for X-Hook-Signature header (case-insensitive)
			let signature = '';

			// Check for signature in headers (case-insensitive)
			for (const [key, value] of Object.entries(headerData)) {
				if (key.toLowerCase() === 'x-hook-signature' || key.toLowerCase() === 'x-autotask-signature') {
					signature = value as string;
					break;
				}
			}

			if (!signature) {
				// For deactivation events, signature might be optional
				if ((bodyData.eventType as string) === 'Deactivated') {
					console.log('No signature found but this is a deactivation event - proceeding without verification');
				} else {
					console.error('No signature found in webhook request headers');
					throw new NodeOperationError(this.getNode(), 'Missing webhook signature');
				}
			} else {
				try {
					// Get the request body as it was received
					const rawRequestBody = JSON.stringify(rawBodyData);

					// Try to verify using the raw request body
					if (!verifyWebhookSignature(rawRequestBody, signature, secretKey)) {
						// For deactivation events, allow proceeding even with invalid signature
						if ((bodyData.eventType as string) === 'Deactivated') {
							console.warn('Invalid signature for deactivation event - proceeding anyway for safety');
						} else {
							console.error('Invalid webhook signature detected');
							throw new NodeOperationError(this.getNode(), 'Invalid webhook signature');
						}
					} else {
						console.log('Webhook signature verified successfully');
					}
				} catch (error) {
					// For deactivation events, continue even if signature verification fails
					if ((bodyData.eventType as string) === 'Deactivated') {
						console.warn(`Signature verification failed for deactivation event: ${(error as Error).message} - proceeding anyway`);
					} else {
						console.error('Error verifying webhook signature:', error);
						throw new NodeOperationError(
							this.getNode(),
							`Webhook signature verification failed: ${(error as Error).message}`,
						);
					}
				}
			}
		} else {
			console.warn('No secret key found in workflow static data. Skipping signature verification.');
			// This case should only happen for webhooks created before this change
		}

		console.log('Webhook event processing completed successfully');

		// Return the webhook data with both mapped and raw data for flexibility
		return {
			workflowData: [
				this.helpers.returnJsonArray([
					{
						headers: headerData,
						body: rawBodyData, // Include the original raw payload
						mappedBody: bodyData, // Include our mapped version
						entityType: bodyData.entityType,
						normalizedEntityType: normalizedEntityType, // Include the normalized entity type
						originalEntityType: receivedEntityType, // Include the original entity type
						eventType: bodyData.eventType,
						entityId: bodyData.entityId,
						entityData: bodyData.entityData,
						timestamp: bodyData.timestamp,
						webhookId: bodyData.webhookId,
						// Include more raw fields that might be useful
						guid: rawBodyData.Guid,
						sequenceNumber: rawBodyData.SequenceNumber,
						personId: rawBodyData.PersonID,
					},
				]),
			],
		};
	}

	/**
	 * Handle deactivation webhook calls from Autotask
	 */
	async setupWebhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		try {
			console.log('Webhook deactivation request received');

			// Get payload and webhook ID
			const bodyData = this.getBodyData() as IDataObject;
			const webhookId = bodyData.webhookId as string | number;

			// Clear the webhook from static data
			if (webhookId) {
				const webhookData = this.getWorkflowStaticData('node');
				// Only clear if it matches our stored webhook ID
				if (webhookData.webhookId === webhookId) {
					webhookData.webhookId = undefined;
					console.log(`Autotask webhook ${webhookId} deactivated and cleared`);
				}
			}

			// Return success response
			return {
				webhookResponse: {
					statusCode: 200,
					body: {
						status: 'success',
						message: 'Webhook deactivation received',
					},
				},
			};
		} catch (error) {
			console.error('Error handling webhook deactivation:', error);
			// Still return 200 to acknowledge receipt
			return {
				webhookResponse: {
					statusCode: 200,
					body: {
						status: 'error',
						message: 'Error processing deactivation',
					},
				},
			};
		}
	}
}
