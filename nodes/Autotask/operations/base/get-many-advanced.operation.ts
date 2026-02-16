import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../../types';
import type { IFilterCondition } from '../../types/base/entity-types';
import { GetManyOperation } from './get-many';
import { BaseOperation } from './base-operation';
import { OperationType } from '../../types/base/entity-types';
import { FieldProcessor } from './field-processor';
import { processResponseDatesArray } from '../../helpers/date-time';
import { getSelectedColumns, prepareIncludeFields } from '../common/select-columns';
import { handleErrors } from '../../helpers/errorHandler';
import { flattenUdfsArray } from '../../helpers/udf/flatten';

/**
 * Base class for retrieving multiple entities using advanced JSON filtering
 */
export class GetManyAdvancedOperation<T extends IAutotaskEntity> extends BaseOperation {
	private readonly getManyOp: GetManyOperation<T>;

	constructor(
		entityType: string,
		context: IExecuteFunctions,
		options?: {
			pageSize?: number;
			maxPages?: number;
			isPicklistQuery?: boolean;
			picklistFields?: string[];
			parentType?: string;
		},
	) {
		super(entityType, OperationType.READ, context, options?.parentType);
		this.getManyOp = new GetManyOperation<T>(
			entityType,
			context,
			{ ...options, skipEnrichment: true },
		);
	}

	/**
	 * Parse and validate advanced filter JSON
	 */
	protected async parseAdvancedFilter(itemIndex: number): Promise<IAutotaskQueryInput<T>> {
		const advancedFilter = await this.getParameter('advancedFilter', itemIndex);

		try {
			// Handle both string and object inputs
			const queryInput = typeof advancedFilter === 'string' ? JSON.parse(advancedFilter) : advancedFilter;

			// Validate filter structure
			if (!queryInput.filter || !Array.isArray(queryInput.filter)) {
				throw new Error('Advanced filter must contain a "filter" array');
			}

			// Validate filter conditions
			const validateFilter = (filter: IFilterCondition): void => {
				if (filter.items) {
					// Group condition
					if (!['and', 'or'].includes(filter.op)) {
						throw new Error('Group operator must be "and" or "or"');
					}
					for (const item of filter.items) {
						validateFilter(item);
					}
				} else {
					// Leaf condition
					if (!filter.field || !filter.op) {
						throw new Error('Each filter condition must have a field and operator');
					}
				}
			};

			for (const filterItem of queryInput.filter) {
				validateFilter(filterItem);
			}

			// Handle IncludeFields for API-side column filtering
			// Check if user already included IncludeFields in their advanced filter
			const userIncludedFields = queryInput.IncludeFields && Array.isArray(queryInput.IncludeFields);

			// If user hasn't specified IncludeFields, add based on selected columns
			if (!userIncludedFields) {
				// Get selected columns and picklist labels flag
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

				// Add IncludeFields to query if there are specific fields to include
				if (includeFields.length > 0) {
					queryInput.IncludeFields = includeFields;
					console.debug(`[GetManyAdvancedOperation] Adding IncludeFields with ${includeFields.length} fields to advanced filter`);
				}
			} else {
				// User provided IncludeFields, ensure id is included
				if (!queryInput.IncludeFields.includes('id')) {
					queryInput.IncludeFields.push('id');
					console.debug('[GetManyAdvancedOperation] Adding required id field to user-provided IncludeFields');
				}
			}

			return queryInput;
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error(`Invalid JSON in advanced filter: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * Execute get many operation with advanced filtering
	 */
	async execute(itemIndex = 0): Promise<T[]> {
		return await handleErrors(
			this.context,
			async () => {
				// Parse advanced filter
				const queryInput = await this.parseAdvancedFilter(itemIndex);

				// Check if returnAll is false, if so, get the maxRecords parameter
				const returnAll = this.context.getNodeParameter('returnAll', itemIndex, true) as boolean;
				if (!returnAll) {
					const maxRecords = this.context.getNodeParameter('maxRecords', itemIndex, 10) as number;
					// Add MaxRecords to the query input
					queryInput.MaxRecords = maxRecords;
				}

				// Check for column selection only if IncludeFields wasn't already set by parseAdvancedFilter
				if (!queryInput.IncludeFields) {
					try {
						const selectedColumns = getSelectedColumns(this.context, itemIndex);
						if (selectedColumns?.length) {
							// Get label options from parameters
							const addPicklistLabels = this.context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;
							const addReferenceLabels = this.context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;

							// Set IncludeFields in the query
							const includeFields = prepareIncludeFields(selectedColumns, {
								addPicklistLabels,
								addReferenceLabels,
							});
							queryInput.IncludeFields = includeFields;
							console.debug(`[GetManyAdvancedOperation] Using IncludeFields with ${includeFields.length} fields`);
						}
					} catch (error) {
						// If parameter doesn't exist or there's an error, log it but don't fail the operation
						console.warn(`[GetManyAdvancedOperation] Error preparing IncludeFields: ${error.message}`);
					}
				}

				// Execute query with pagination
				let results = await this.getManyOp.execute(queryInput, itemIndex);

				// Get field processor instance for enrichment
				const fieldProcessor = FieldProcessor.getInstance(
					this.entityType,
					this.operation,
					this.context,
				);

				// Check if reference labels should be added (must be processed before picklist labels)
				try {
					const addReferenceLabels = this.context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;

					if (addReferenceLabels && results.length > 0) {
						console.debug(`[GetManyAdvancedOperation] Adding reference labels for ${results.length} ${this.entityType} entities`);
						// Enrich entities with reference labels
						results = await fieldProcessor.enrichWithReferenceLabels(results) as T[];
					}
				} catch (error) {
					// If parameter doesn't exist or there's an error, log it but don't fail the operation
					console.warn(`[GetManyAdvancedOperation] Error processing reference labels: ${error.message}`);
				}

				// Check if picklist labels should be added
				try {
					const addPicklistLabels = this.context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;

					if (addPicklistLabels && results.length > 0) {
						console.debug(`[GetManyAdvancedOperation] Adding picklist labels for ${results.length} ${this.entityType} entities`);
						// Enrich entities with picklist labels
						results = await fieldProcessor.enrichWithPicklistLabels(results) as T[];
					}
				} catch (error) {
					// If parameter doesn't exist or there's an error, log it but don't fail the operation
					console.warn(`[GetManyAdvancedOperation] Error processing picklist labels: ${error.message}`);
				}

				// Process dates in response before returning
				try {
					const processedResults = await processResponseDatesArray.call(
						this.context,
						results,
						`${this.entityType}.getManyAdvanced`,
					);

					// Check if UDFs should be flattened
					try {
						const shouldFlattenUdfs = this.context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;

						if (shouldFlattenUdfs) {
							console.debug(`[GetManyAdvancedOperation] Flattening UDFs for ${processedResults.length} ${this.entityType} entities`);
							return flattenUdfsArray(processedResults as T[]);
						}
					} catch (error) {
						// If parameter doesn't exist or there's an error, log it but don't fail the operation
						console.warn(`[GetManyAdvancedOperation] Error flattening UDFs: ${error.message}`);
					}

					// Return processed results directly without client-side filtering
					console.debug(`[GetManyAdvancedOperation] Returning ${processedResults.length} items from API response`);
					return processedResults as T[];
				} catch (error) {
					console.warn(`[GetManyAdvancedOperation] Error processing dates: ${error.message}`);

					// Check if UDFs should be flattened even though date processing failed
					try {
						const shouldFlattenUdfs = this.context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;

						if (shouldFlattenUdfs) {
							console.debug(`[GetManyAdvancedOperation] Flattening UDFs for ${results.length} ${this.entityType} entities`);
							return flattenUdfsArray(results);
						}
					} catch (error) {
						// If parameter doesn't exist or there's an error, log it but don't fail the operation
						console.warn(`[GetManyAdvancedOperation] Error flattening UDFs: ${error.message}`);
					}

					// Return original results if date processing fails
					return results;
				}
			},
			{
				operation: 'getManyAdvanced',
				entityType: this.entityType,
			}
		);
	}
}
