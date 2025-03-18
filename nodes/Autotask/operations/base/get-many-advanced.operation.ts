import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../../types';
import type { IFilterCondition } from '../../types/base/entity-types';
import { GetManyOperation } from './get-many';
import { BaseOperation } from './base-operation';
import { OperationType } from '../../types/base/entity-types';
import { FieldProcessor } from './field-processor';
import { processResponseDatesArray } from '../../helpers/date-time';
import { filterEntitiesBySelectedColumns, getSelectedColumns, prepareIncludeFields } from '../common/select-columns';
import { handleErrors } from '../../helpers/errorHandler';

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
			options,
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
					filter.items.forEach(validateFilter);
				} else {
					// Leaf condition
					if (!filter.field || !filter.op) {
						throw new Error('Each filter condition must have a field and operator');
					}
				}
			};

			queryInput.filter.forEach(validateFilter);

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

				// Check for column selection
				try {
					const selectedColumns = getSelectedColumns(this.context, itemIndex);
					if (selectedColumns && selectedColumns.length) {
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

					// Get selected columns to determine if client-side filtering is needed
					const selectedColumns = getSelectedColumns(this.context, itemIndex);

					// If no columns selected or server-side filtering was used via IncludeFields,
					// we can skip client-side filtering
					if (!selectedColumns || !selectedColumns.length || queryInput.IncludeFields?.length) {
						return processedResults as T[];
					}

					// Apply client-side filtering as a fallback if server-side filtering wasn't used
					console.debug(`[GetManyAdvancedOperation] Applying client-side filtering as fallback`);
					const filteredResults = filterEntitiesBySelectedColumns(processedResults as T[], selectedColumns) as T[];

					// Log filtered vs original count for debugging
					const originalFieldCount = processedResults.length > 0 ? Object.keys(processedResults[0]).length : 0;
					const filteredFieldCount = filteredResults.length > 0 ? Object.keys(filteredResults[0]).length : 0;
					if (originalFieldCount !== filteredFieldCount) {
						console.debug(`[GetManyAdvancedOperation] Additional client-side filtering applied: ${originalFieldCount} -> ${filteredFieldCount} fields`);
					}

					return filteredResults;
				} catch (error) {
					console.warn(`[GetManyAdvancedOperation] Error processing dates: ${error.message}`);

					// Handle error case - apply client-side filtering if selected columns exist
					const selectedColumns = getSelectedColumns(this.context, itemIndex);
					if (selectedColumns?.length) {
						const filteredResults = filterEntitiesBySelectedColumns(results, selectedColumns) as T[];
						return filteredResults;
					}

					return results; // Return original if conversion fails and no filtering requested
				}
			},
			{
				operation: 'getManyAdvanced',
				entityType: this.entityType,
			}
		);
	}
}
