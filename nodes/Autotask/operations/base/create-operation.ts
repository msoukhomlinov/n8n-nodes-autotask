import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http/request';
import { handleErrors } from '../../helpers/errorHandler';
import { getOperationFieldValues, validateFieldValues } from './field-values';
import { processResponseDates } from '../../helpers/date-time';
import { processOutputMode } from '../../helpers/output-mode';
import { getEntityMetadata } from '../../constants/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { buildRequestBody } from '../../helpers/http/body-builder';
import { FieldProcessor } from './field-processor';
import { BaseOperation } from './base-operation';
import { convertDatesToUTC } from '../../helpers/date-time/utils';
import { isDryRunEnabled, createDryRunResponse } from '../../helpers/dry-run';
import { withAgentHint } from '../../helpers/agent-error-hints';
import { resolveLabelsToIds } from '../../helpers/label-resolution';
import { withInactiveRefRetry } from '../../helpers/inactive-entity-activation';
import {
	getOptionalImpersonationResourceId,
	isImpersonationSupportedForEndpoint,
} from '../../helpers/impersonation';

/**
 * Base class for creating entities
 * Extends BaseOperation to handle both direct and indirect parent-child relationships
 */
export class CreateOperation<T extends IAutotaskEntity> extends BaseOperation {
	private readonly fieldProcessor: FieldProcessor;

	constructor(
		entityType: string,
		context: IExecuteFunctions,
	) {
		// Get metadata to check if this is a child entity that requires parent context
		const metadata = getEntityMetadata(entityType);
		const parentType = metadata?.operations?.create === 'parent' ? metadata.childOf : undefined;

		super(entityType, OperationType.CREATE, context, parentType);
		this.fieldProcessor = FieldProcessor.getInstance(entityType, OperationType.CREATE, context);
	}

	/**
	 * Execute the create operation
	 */
	async execute(itemIndex = 0): Promise<T> {
		return await handleErrors(
			this.context,
			async () => {
				console.debug('[CreateOperation] Starting create for', this.entityType);

				// Get raw field values
				const rawFieldValues = await getOperationFieldValues(
					this.context,
					this.entityType,
					itemIndex,
					'create',
				);
				console.debug('[CreateOperation] Raw field values:', rawFieldValues);

				// Validate and convert field values (including timezone conversion for date fields)
				const validatedData = await validateFieldValues(
					this.context,
					this.entityType,
					rawFieldValues,
					itemIndex,
					'create',
				);
				console.debug('[CreateOperation] Validated data:', validatedData);

				// Resolve labels to IDs for picklist/reference fields
				const resolution = await resolveLabelsToIds(this.context, this.entityType, validatedData);
				if (resolution.resolutions.length > 0) {
					console.debug('[CreateOperation] Label-to-ID resolutions:', resolution.resolutions);
				}

			// Apply centralized date conversion (closest to API boundary)
			const apiReadyData = await convertDatesToUTC(
				resolution.values,
				this.entityType,
				this.context,
				'CreateOperation'
			);
			console.debug('[CreateOperation] API-ready data with date conversion:', apiReadyData);

			// Build operation URL - pass parent ID from validated data to avoid lookup issues in autoMapInputData mode
			const metadata = getEntityMetadata(this.entityType);
			const parentIdField = metadata?.parentIdField || (metadata?.childOf ? `${metadata.childOf}ID` : undefined);
			const parentIdValue = parentIdField ? (apiReadyData as IDataObject)[parentIdField] : undefined;
			const parentIdOverride = (typeof parentIdValue === 'string' || typeof parentIdValue === 'number') ? parentIdValue : undefined;

			const endpoint = await this.buildOperationUrl(itemIndex, parentIdOverride !== undefined ? { parentIdOverride } : {});
			console.debug('[CreateOperation] Using endpoint:', endpoint);

			let impersonationResourceId: number | undefined;
			let proceedWithoutImpersonationIfDenied = false;
			if (isImpersonationSupportedForEndpoint(endpoint)) {
				try {
					impersonationResourceId = getOptionalImpersonationResourceId(this.context, itemIndex);
					if (impersonationResourceId !== undefined) {
						proceedWithoutImpersonationIfDenied = this.context.getNodeParameter(
							'proceedWithoutImpersonationIfDenied',
							itemIndex,
							false,
						) as boolean;
					}
				} catch (error) {
					if (
						error instanceof Error &&
						error.message.includes('Could not get parameter')
					) {
						impersonationResourceId = undefined;
					} else {
						throw error;
					}
				}
			}

				try {
					// Build request body
					const { body: requestBody } = await buildRequestBody({
						validatedData: apiReadyData, // Use date-converted data
						entityType: this.entityType,
						operation: 'create',
						fieldProcessor: this.fieldProcessor,
					});

					console.debug('Request body:', requestBody);

					// Check for dry-run mode
					if (isDryRunEnabled(this.context, itemIndex)) {
						console.debug('[CreateOperation] Dry-run mode enabled, returning request preview');
						const preview = await createDryRunResponse(
							this.context,
							this.entityType,
							'create',
							{
								method: 'POST',
								url: endpoint,
								body: requestBody,
							},
							itemIndex
						);

						// Attach label-to-ID resolution map to preview for agent visibility
						(preview as unknown as IDataObject).resolutions = resolution.resolutions as unknown as IDataObject[];
						Object.assign(preview as unknown as IDataObject, {
							...(impersonationResourceId !== undefined && { impersonationResourceId }),
							...(impersonationResourceId !== undefined && { proceedWithoutImpersonationIfDenied }),
						});
						return preview as unknown as T;
					}

					// Create entity using autotaskApiRequest's built-in pluralization.
					// Wrapped with inactive-entity retry: if the API rejects because a
					// reference field points to an inactive contact/resource, the helper
					// temporarily activates it, retries, then deactivates.
					const inactiveRefWarnings: string[] = [];
					const response = await withInactiveRefRetry(
						this.context,
						inactiveRefWarnings,
						async () => autotaskApiRequest.call(
							this.context,
							'POST',
							endpoint,
							requestBody,
							{},
							impersonationResourceId,
							proceedWithoutImpersonationIfDenied,
						),
						apiReadyData as IDataObject,
					) as IDataObject;
					if (inactiveRefWarnings.length > 0) {
						console.warn(`[CreateOperation] ${this.entityType}:`, inactiveRefWarnings.join('; '));
					}

					if (!response) {
						const error = new Error(
							ERROR_TEMPLATES.operation
								.replace('{type}', 'ResponseError')
								.replace('{operation}', 'create')
								.replace('{entity}', this.entityType)
								.replace('{details}', 'Invalid API response: empty response')
						);
						throw withAgentHint(error, {
							resource: this.entityType,
							operation: 'create',
						});
					}

					// Process any date fields in the response and apply output mode
					let entity = await processResponseDates.call(
						this.context,
						response,
						`${this.entityType}.create`,
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
							console.debug('[CreateOperation] Endpoint not found error detected');
							const enhancedError = new Error(
								ERROR_TEMPLATES.validation
									.replace('{type}', 'ValidationError')
									.replace('{entity}', this.entityType)
									.replace('{details}', `Invalid endpoint: ${endpoint}`)
							);
							throw withAgentHint(enhancedError, {
								resource: this.entityType,
								operation: 'create',
							});
						}
					}
					throw error;
				}
			},
			{
				operation: 'create',
				entityType: this.entityType,
			},
		);
	}
}

