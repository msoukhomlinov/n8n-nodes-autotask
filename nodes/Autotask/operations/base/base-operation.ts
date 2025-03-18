import type {
	IExecuteFunctions,
	INodeProperties,
	INodePropertyOptions,
	NodePropertyTypes,
	IDataObject,
	IBinaryData,
} from 'n8n-workflow';
import type { IEntityField } from '../../types/base/entities';
import { handleErrors } from '../../helpers/errorHandler';
import { fieldTypeService } from '../../helpers/field-conversion/utils';
import type { IFieldMappingContext } from '../../helpers/field-conversion/services/field-type.service';
import { OperationTypeValidator } from './operation-type';
import { OperationType } from './types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { sortPicklistValues } from '../../helpers/field-conversion/utils';
import { buildEntityUrl, buildChildEntityUrl, type IUrlOptions } from '../../helpers/http/request';
import { getParameterInsensitive } from '../../helpers/parameter';
import type { IAutotaskEntity, IAutotaskResponse } from '../../types';
import { getEntityMetadata } from '../../constants/entities';
import { autotaskApiRequest } from '../../helpers/http';
import { processResponseDates } from '../../helpers/date-time';
import { getSelectedColumns, prepareIncludeFields } from '../common/select-columns';

/**
 * Base class for all Autotask operations
 */
export class BaseOperation {
	protected readonly operationHandler: OperationTypeValidator;
	protected readonly entityType: string;
	protected readonly parentType?: string;
	protected readonly parentChain?: string[];

	constructor(
		entityType: string,
		protected readonly operation: OperationType,
		protected readonly context: IExecuteFunctions,
		parentType?: string,
		parentChain?: string[],
	) {
		this.operationHandler = new OperationTypeValidator();
		this.entityType = entityType;
		this.parentType = parentType;
		this.parentChain = parentChain;
	}

	/**
	 * Get a parameter value in a case-insensitive way
	 * For ID fields, the preferred format is 'id' for entity IDs and '{parentType}ID' for parent IDs
	 */
	protected async getParameter(parameterName: string, itemIndex: number): Promise<unknown> {
		try {
			return getParameterInsensitive(this.context, parameterName, itemIndex);
		} catch (error) {
			// Get entity metadata to check for parent ID field
			const metadata = getEntityMetadata(this.entityType);

			// Case-insensitive check for parent ID field
			const isParentIdParam = metadata?.parentIdField?.toLowerCase() === parameterName.toLowerCase() ||
				(metadata?.childOf && `${metadata.childOf}ID`.toLowerCase() === parameterName.toLowerCase());

			// For parent ID fields, try multiple sources
			if (isParentIdParam) {
				console.debug(`[BaseOperation] Checking sources for parent ID field: ${parameterName}`);

				// 1. Try node parameters
				try {
					const value = this.context.getNodeParameter(parameterName, itemIndex, null);
					if (value !== null) {
						console.debug(`[BaseOperation] Found parent ID in node parameters: ${value}`);
						return value;
					}
				} catch (e) {
					// Ignore error and continue checking other sources
				}

				// 2. Try validated data
				try {
					const fieldsToMap = this.context.getNodeParameter('fieldsToMap', itemIndex, {}) as {
						value?: IDataObject;
					};
					if (fieldsToMap?.value) {
						// Case-insensitive check for field in validated data
						const field = Object.keys(fieldsToMap.value).find(
							key => key.toLowerCase() === parameterName.toLowerCase()
						);
						if (field) {
							console.debug(`[BaseOperation] Found parent ID in validated data: ${fieldsToMap.value[field]}`);
							return fieldsToMap.value[field];
						}
					}
				} catch (e) {
					// Ignore error and continue
				}

				// 3. Try to get from existing record if we have an entity ID
				try {
					const entityId = this.context.getNodeParameter('id', itemIndex, null);
					if (entityId !== null && (typeof entityId === 'string' || typeof entityId === 'number')) {
						console.debug('[BaseOperation] Fetching existing record for parent ID, entityId:', entityId);
						const existingRecord = await this.getEntityById(itemIndex, entityId);

						// Case-insensitive check for parent ID field in existing record
						const recordField = Object.keys(existingRecord).find(
							key => key.toLowerCase() === parameterName.toLowerCase()
						);

						if (recordField && existingRecord[recordField] !== undefined &&
							existingRecord[recordField] !== null &&
							(typeof existingRecord[recordField] === 'string' ||
							typeof existingRecord[recordField] === 'number')) {
							console.debug('[BaseOperation] Found parent ID in existing record:', existingRecord[recordField]);
							return existingRecord[recordField];
						}
						console.debug('[BaseOperation] Parent ID not found or invalid in existing record');
					}
				} catch (e) {
					console.debug('[BaseOperation] Error fetching existing record:', e.message);
				}

				console.debug(`[BaseOperation] Parent ID field ${parameterName} not found in any source`);
				return undefined;
			}

			throw new Error(
				ERROR_TEMPLATES.validation
					.replace('{type}', 'ValidationError')
					.replace('{entity}', this.entityType)
					.replace('{details}', error.message)
			);
		}
	}

	/**
	 * Get parent chain IDs for nested resources
	 */
	protected async getParentChainIds(itemIndex: number): Promise<Array<{ type: string; id: string | number }>> {
		if (!this.parentChain?.length) {
			return [];
		}

		const chainIds = [];
		for (const parentType of this.parentChain) {
			const parentId = await this.getParameter(`${parentType}ID`, itemIndex);
			if (typeof parentId !== 'string' && typeof parentId !== 'number') {
				throw new Error(
					ERROR_TEMPLATES.validation
						.replace('{type}', 'ValidationError')
						.replace('{entity}', this.entityType)
						.replace('{details}', `Invalid parent ID type for ${parentType} in chain`)
				);
			}
			chainIds.push({ type: parentType, id: parentId });
		}
		return chainIds;
	}

	/**
	 * Get an entity by ID
	 */
	protected async getEntityById(itemIndex: number, entityId: string | number): Promise<IAutotaskEntity> {
		return await handleErrors(
			this.context,
			async () => {
				// Use direct URL for fetching records to avoid circular dependency
				const endpoint = buildEntityUrl(this.entityType, { entityId: String(entityId) });

				// Get selected columns and prepare include fields for API
				const selectedColumns = getSelectedColumns(this.context, itemIndex);

				// Check if picklist labels should be added
				let addPicklistLabels = false;
				try {
					addPicklistLabels = this.context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;
				} catch (error) {
					// If parameter doesn't exist or there's an error, default to false
				}

				// Prepare include fields for API request
				const includeFields = prepareIncludeFields(selectedColumns, { addPicklistLabels });

				// Prepare request options with query parameters if needed
				const requestQuery: IDataObject = {};

				// Add IncludeFields to query parameters if there are specific fields to include
				if (includeFields.length > 0) {
					requestQuery.IncludeFields = includeFields;
					console.debug(`[BaseOperation] Using IncludeFields with ${includeFields.length} fields for getEntityById`);
				}

				// Get entity
				const response = await autotaskApiRequest.call(
					this.context,
					'GET',
					endpoint,
					{},
					requestQuery,
				) as IAutotaskResponse<IAutotaskEntity>;

				if (!response.item) {
					throw new Error(
						ERROR_TEMPLATES.notFound
							.replace('{type}', 'NotFoundError')
							.replace('{entity}', this.entityType)
							.replace('{details}', `Entity with ID ${entityId} not found`)
					);
				}

				// Process dates in response
				return await processResponseDates.call(
					this.context,
					response.item,
					`${this.entityType}.get`,
				) as IAutotaskEntity;
			},
			{
				operation: 'get',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Get fields for the operation
	 */
	protected async getFields(): Promise<INodeProperties[]> {
		return handleErrors(
			this.context,
			async () => {
				const fields = await this.getEntityFields();
				return this.mapFieldsToProperties(fields);
			},
		);
	}

	/**
	 * Process field values for the operation
	 */
	protected async processFieldValues(values: unknown): Promise<unknown> {
		return handleErrors(
			this.context,
			async () => {
				const fields = await this.getEntityFields();
				return this.mapValuesToFields(fields, values);
			},
		);
	}

	/**
	 * Get field options for resource mapper
	 */
	protected async getFieldOptions(): Promise<INodePropertyOptions[]> {
		return handleErrors(
			this.context,
			async () => {
				const fields = await this.getEntityFields();
				return this.mapFieldsToOptions(fields);
			},
		);
	}

	/**
	 * Get fields for the entity
	 */
	protected async getEntityFields(): Promise<IEntityField[]> {
		// Implementation of getEntityFields method
		return [];
	}

	/**
	 * Map fields to node properties
	 */
	protected mapFieldsToProperties(fields: IEntityField[]): INodeProperties[] {
		return fields.map(field => {
			const context: IFieldMappingContext = {
				mode: this.operationHandler.isWriteOperation(this.operation) ? 'write' : 'read',
				operation: this.operation,
				entityType: this.entityType,
				isResourceMapper: false,
			};

			const properties: INodeProperties = {
				displayName: field.label,
				name: field.name,
				type: fieldTypeService.mapFieldType(field, context) as NodePropertyTypes,
				default: '',
				description: field.description || undefined,
				required: field.isRequired,
			};

			// Add options for picklist fields
			if (field.isPickList && Array.isArray(field.picklistValues)) {
				properties.options = sortPicklistValues(field.picklistValues.filter(value => value.isActive))
					.map(value => ({
						name: value.label,
						value: String(value.value),
						description: value.isDefaultValue ? 'Default value' : undefined,
					}));
			}

			return properties;
		});
	}

	/**
	 * Map values to fields
	 */
	protected mapValuesToFields(fields: IEntityField[], values: unknown): unknown {
		// Implement value mapping logic
		return values;
	}

	/**
	 * Map fields to options
	 */
	protected mapFieldsToOptions(fields: IEntityField[]): INodePropertyOptions[] {
		return fields.map(field => ({
			name: field.label,
			value: field.name,
			description: field.description || undefined,
		}));
	}

	/**
	 * Build the URL for this operation
	 */
	protected async buildOperationUrl(itemIndex: number, options: IUrlOptions = {}): Promise<string> {
		const metadata = getEntityMetadata(this.entityType);

		// Handle attachment entities
		if (metadata?.isAttachment && options.entityId) {
			return buildEntityUrl(this.entityType, { ...options, isAttachment: true });
		}

		// Handle nested resources
		if (this.parentChain?.length) {
			const parentChainIds = await this.getParentChainIds(itemIndex);
			return buildEntityUrl(this.entityType, { ...options, parentChain: parentChainIds });
		}

		// Handle direct child resources
		if (this.parentType) {
			const parentId = await this.getParameter(`${this.parentType}ID`, itemIndex);
			if (typeof parentId !== 'string' && typeof parentId !== 'number') {
				throw new Error(
					ERROR_TEMPLATES.validation
						.replace('{type}', 'ValidationError')
						.replace('{entity}', this.entityType)
						.replace('{details}', `Invalid parent ID type for ${this.parentType}`)
				);
			}

			// For update operations that should be done via parent, use parent/child endpoint without entity ID
			if (this.operation === OperationType.UPDATE && metadata?.operations?.update === 'parent') {
				// Create a new object without the entityId property
				const urlOptions = { ...options };
				delete urlOptions.entityId;
				return buildChildEntityUrl(
					this.parentType,
					this.entityType,
					parentId,
					urlOptions,
				);
			}

			return buildChildEntityUrl(
				this.parentType,
				this.entityType,
				parentId,
				options,
			);
		}

		// Standard entity operation
		return buildEntityUrl(this.entityType, options);
	}

	/**
	 * Build a query URL for this entity
	 */
	protected buildQueryUrl(): string {
		return buildEntityUrl(this.entityType, { isQuery: true });
	}

	/**
	 * Build a count URL for this entity
	 */
	protected buildCountUrl(): string {
		// Always use /query/count endpoint
		return buildEntityUrl(this.entityType, { isQuery: true, isCount: true });
	}

	/**
	 * Build a UDF URL for this entity
	 */
	protected buildUdfUrl(): string {
		return buildEntityUrl(this.entityType, { isUdf: true });
	}

	/**
	 * Execute a count operation for this entity
	 */
	protected async executeCount(itemIndex: number, filter: IDataObject = { filter: [] }): Promise<number> {
		return await handleErrors(
			this.context,
			async () => {
				const endpoint = this.buildCountUrl();
				const response = await autotaskApiRequest.call(
					this.context,
					'POST',
					endpoint,
					filter,
				) as IAutotaskResponse<{ count: number }>;

				if (typeof response?.item?.count !== 'number') {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Invalid count response from API')
					);
				}

				return response.item.count;
			},
			{
				operation: 'count',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Build an attachment URL for this entity
	 */
	protected buildAttachmentUrl(attachmentId: string | number): string {
		return buildEntityUrl(this.entityType, { entityId: attachmentId, isAttachment: true });
	}

	/**
	 * Upload an attachment
	 */
	protected async uploadAttachment(
		itemIndex: number,
		data: IBinaryData,
		options: {
			title: string;
			parentId?: string | number;
			parentType?: string;
			publish?: boolean;
		},
	): Promise<IAutotaskEntity> {
		return await handleErrors(
			this.context,
			async () => {
				const metadata = getEntityMetadata(this.entityType);
				if (!metadata?.isAttachment) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity does not support attachments')
					);
				}

				// Build the URL for attachment upload
				const endpoint = await this.buildOperationUrl(itemIndex);

				// Prepare the attachment data
				const attachmentData = {
					title: options.title,
					parentId: options.parentId,
					parentType: options.parentType,
					publish: options.publish ?? true,
					data: data.data,
					contentType: data.mimeType,
					fileName: data.fileName,
				};

				// Upload the attachment
				const response = await autotaskApiRequest.call(
					this.context,
					'POST',
					endpoint,
					attachmentData,
				) as IAutotaskResponse<IAutotaskEntity>;

				if (!response.item) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Failed to upload attachment')
					);
				}

				return response.item;
			},
			{
				operation: 'upload',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Download an attachment
	 */
	protected async downloadAttachment(itemIndex: number, attachmentId: string | number): Promise<IBinaryData> {
		return await handleErrors(
			this.context,
			async () => {
				const metadata = getEntityMetadata(this.entityType);
				if (!metadata?.isAttachment) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity does not support attachments')
					);
				}

				// Build the URL for attachment download
				const endpoint = this.buildAttachmentUrl(attachmentId);

				// Download the attachment
				const response = await autotaskApiRequest.call(
					this.context,
					'GET',
					endpoint,
				) as IAutotaskResponse<{
					data: string;
					contentType: string;
					fileName: string;
				}>;

				if (!response.item?.data) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Failed to download attachment')
					);
				}

				return {
					data: response.item.data,
					mimeType: response.item.contentType,
					fileName: response.item.fileName,
				};
			},
			{
				operation: 'download',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Delete an attachment
	 */
	protected async deleteAttachment(itemIndex: number, attachmentId: string | number): Promise<void> {
		return await handleErrors(
			this.context,
			async () => {
				const metadata = getEntityMetadata(this.entityType);
				if (!metadata?.isAttachment) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity does not support attachments')
					);
				}

				// Build the URL for attachment deletion
				const endpoint = this.buildAttachmentUrl(attachmentId);

				// Delete the attachment
				await autotaskApiRequest.call(
					this.context,
					'DELETE',
					endpoint,
				);
			},
			{
				operation: 'delete',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Get attachment info
	 */
	protected async getAttachmentInfo(itemIndex: number, attachmentId: string | number): Promise<IAutotaskEntity> {
		return await handleErrors(
			this.context,
			async () => {
				const metadata = getEntityMetadata(this.entityType);
				if (!metadata?.isAttachment) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity does not support attachments')
					);
				}

				// Build the URL for attachment info
				const endpoint = await this.buildOperationUrl(itemIndex, { entityId: attachmentId });

				// Get attachment info
				const response = await autotaskApiRequest.call(
					this.context,
					'GET',
					endpoint,
				) as IAutotaskResponse<IAutotaskEntity>;

				if (!response.item) {
					throw new Error(
						ERROR_TEMPLATES.notFound
							.replace('{type}', 'NotFoundError')
							.replace('{entity}', this.entityType)
							.replace('{details}', `Attachment with ID ${attachmentId} not found`)
					);
				}

				return response.item;
			},
			{
				operation: 'get',
				entityType: this.entityType,
			},
		);
	}
}
