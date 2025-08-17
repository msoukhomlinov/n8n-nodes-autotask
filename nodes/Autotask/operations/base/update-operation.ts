import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http/request';
import { handleErrors } from '../../helpers/errorHandler';
import { getOperationFieldValues, validateFieldValues } from './field-values';
import { processResponseDates } from '../../helpers/date-time';
import { processOutputMode } from '../../helpers/output-mode';
import { buildRequestBody } from '../../helpers/http/body-builder';
import { BaseOperation } from './base-operation';
import { FieldProcessor } from './field-processor';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { getEntityMetadata } from '../../constants/entities';
import { convertDatesToUTC } from '../../helpers/date-time/utils';
import { isDryRunEnabled, createDryRunResponse } from '../../helpers/dry-run';
import { resolveLabelsToIds } from '../../helpers/label-resolution';

/**
 * Base class for updating entities
 * Extends BaseOperation to handle both direct and indirect parent-child relationships
 */
export class UpdateOperation<T extends IAutotaskEntity> extends BaseOperation {
	private readonly fieldProcessor: FieldProcessor;

	constructor(
		entityType: string,
		context: IExecuteFunctions,
	) {
		// Get metadata to check if this is a child entity that requires parent context
		const metadata = getEntityMetadata(entityType);
		const parentType = metadata?.operations?.update === 'parent' ? metadata.childOf : undefined;

		super(entityType, OperationType.UPDATE, context, parentType);
		this.fieldProcessor = FieldProcessor.getInstance(entityType, OperationType.UPDATE, context);
	}

	/**
	 * Execute the update operation
	 */
	async execute(itemIndex: number, entityId: string | number): Promise<T> {
		return await handleErrors(
			this.context,
			async () => {
				console.debug('[UpdateOperation] Starting update for', this.entityType, 'ID:', entityId);

				// Get raw field values
				const rawFieldValues = await getOperationFieldValues(
					this.context,
					this.entityType,
					itemIndex,
					'update',
				);
				console.debug('[UpdateOperation] Raw field values:', rawFieldValues);

				// Validate and convert field values (including timezone conversion for date fields)
				const validatedData = await validateFieldValues(
					this.context,
					this.entityType,
					rawFieldValues,
					itemIndex,
					'update',
				);
				console.debug('[UpdateOperation] Validated data:', validatedData);

				// Resolve labels to IDs for picklist/reference fields
				const resolution = await resolveLabelsToIds(this.context, this.entityType, validatedData);
				if (resolution.resolutions.length > 0) {
					console.debug('[UpdateOperation] Label-to-ID resolutions:', resolution.resolutions);
				}

				// Apply centralized date conversion (closest to API boundary)
				const apiReadyData = await convertDatesToUTC(
					resolution.values,
					this.entityType,
					this.context,
					'UpdateOperation'
				);
				console.debug('[UpdateOperation] API-ready data with date conversion:', apiReadyData);

				// Get metadata for operation context
				const metadata = getEntityMetadata(this.entityType);
				console.debug('Entity metadata:', metadata);

				// Build operation URL without entity ID for PATCH
				const endpoint = await this.buildOperationUrl(itemIndex);
				console.debug('[UpdateOperation] Using endpoint:', endpoint);

				try {
					// Build request body
					const { body: requestBody } = await buildRequestBody({
						validatedData: apiReadyData,
						entityType: this.entityType,
						entityId,
						operation: 'update',
						fieldProcessor: this.fieldProcessor,
					});

					console.debug('Request body:', requestBody);

					// Check for dry-run mode
					if (isDryRunEnabled(this.context, itemIndex)) {
						console.debug('[UpdateOperation] Dry-run mode enabled, returning request preview');
						const preview = await createDryRunResponse(
							this.context,
							this.entityType,
							'update',
							{
								method: 'PATCH',
								url: endpoint,
								body: requestBody,
							},
							itemIndex
						);

						// Attach label-to-ID resolution map to preview for agent visibility
						(preview as unknown as IDataObject).resolutions = resolution.resolutions as unknown as IDataObject[];
						return preview as unknown as T;
					}

					// Update entity using autotaskApiRequest's built-in pluralization
					const response = await autotaskApiRequest.call(
						this.context,
						'PATCH',
						endpoint,
						requestBody,
					) as IDataObject;

					if (!response) {
						throw new Error(
							ERROR_TEMPLATES.operation
								.replace('{type}', 'ResponseError')
								.replace('{operation}', 'update')
								.replace('{entity}', this.entityType)
								.replace('{details}', 'Invalid API response: empty response')
						);
					}

					// Process any date fields in the response and apply output mode
					let entity = processResponseDates.call(
						this.context,
						response,
						`${this.entityType}.update`,
					) as unknown as T;

					entity = await processOutputMode(
						entity,
						this.entityType,
						this.context,
						itemIndex,
					) as T;

					return entity;
				} catch (error) {
					// Handle API-specific errors
					if (error instanceof Error) {
						if (error.message.includes('404')) {
							console.debug('[UpdateOperation] Endpoint not found error detected');
							throw new Error(
								ERROR_TEMPLATES.validation
									.replace('{type}', 'ValidationError')
									.replace('{entity}', this.entityType)
									.replace('{details}', `Invalid endpoint: ${endpoint}`)
							);
						}
					}
					throw error;
				}
			},
			{
				operation: 'update',
				entityType: this.entityType,
			},
		);
	}
}
