import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http/request';
import { handleErrors } from '../../helpers/errorHandler';
import { getOperationFieldValues, validateFieldValues } from './field-values';
import { processResponseDates } from '../../helpers/date-time';
import { getEntityMetadata } from '../../constants/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { buildRequestBody } from '../../helpers/http/body-builder';
import { FieldProcessor } from './field-processor';
import { BaseOperation } from './base-operation';
import { convertDatesToUTC } from '../../helpers/date-time/utils';

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

				// Apply centralized date conversion (closest to API boundary)
				const apiReadyData = await convertDatesToUTC(
					validatedData,
					this.entityType,
					this.context,
					'CreateOperation'
				);
				console.debug('[CreateOperation] API-ready data with date conversion:', apiReadyData);

				// Build operation URL
				const endpoint = await this.buildOperationUrl(itemIndex);
				console.debug('[CreateOperation] Using endpoint:', endpoint);

				try {
					// Build request body
					const { body: requestBody } = await buildRequestBody({
						validatedData: apiReadyData, // Use date-converted data
						entityType: this.entityType,
						operation: 'create',
						fieldProcessor: this.fieldProcessor,
					});

					console.debug('Request body:', requestBody);

					// Create entity using autotaskApiRequest's built-in pluralization
					const response = await autotaskApiRequest.call(
						this.context,
						'POST',
						endpoint,
						requestBody,
					) as IDataObject;

					if (!response) {
						throw new Error(
							ERROR_TEMPLATES.operation
								.replace('{type}', 'ResponseError')
								.replace('{operation}', 'create')
								.replace('{entity}', this.entityType)
								.replace('{details}', 'Invalid API response: empty response')
						);
					}

					// Process any date fields in the response
					return processResponseDates.call(
						this.context,
						response,
						`${this.entityType}.create`,
					) as unknown as T;
				} catch (error) {
					// Handle API-specific errors
					if (error instanceof Error) {
						if (error.message.includes('404')) {
							console.debug('[CreateOperation] Endpoint not found error detected');
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
				operation: 'create',
				entityType: this.entityType,
			},
		);
	}
}

