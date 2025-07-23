import type { IExecuteFunctions, IDataObject, INodeExecutionData } from 'n8n-workflow';
import type {
	IAutotaskEntity,
	IAutotaskQueryInput,
	IQueryResponse
} from '../../types';
import { autotaskApiRequest } from '../../helpers/http';
import { PaginationHandler } from '../../helpers/pagination';
import { handleErrors } from '../../helpers/errorHandler';
import { buildFiltersFromResourceMapper } from '../../helpers/filter';
import { FilterOperators } from '../../constants/filters';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { buildEntityUrl, buildChildEntityUrl } from '../../helpers/http/request';
import { getEntityMetadata } from '../../constants/entities';
import { FieldProcessor } from './field-processor';
import { OperationType } from '../../types/base/entity-types';
import { processResponseDatesArray } from '../../helpers/date-time';
import { getSelectedColumns, prepareIncludeFields } from '../common/select-columns';
import { flattenUdfsArray } from '../../helpers/udf/flatten';

/**
 * Base class for retrieving multiple entities
 */
export class GetManyOperation<T extends IAutotaskEntity> {
	private readonly paginationHandler: PaginationHandler;
	private readonly parentType?: string;
	private readonly skipEnrichment: boolean;
	private readonly options?: {
		pageSize?: number;
		maxPages?: number;
		isPicklistQuery?: boolean;
		picklistFields?: string[];
		parentType?: string;
		skipEnrichment?: boolean;
	};

	constructor(
		private readonly entityType: string,
		private readonly context: IExecuteFunctions,
		options?: {
			pageSize?: number;
			maxPages?: number;
			isPicklistQuery?: boolean;
			picklistFields?: string[];
			parentType?: string;
			skipEnrichment?: boolean;
		},
	) {
		this.paginationHandler = new PaginationHandler(entityType, context, options);
		this.parentType = options?.parentType;
		this.options = options;
		this.skipEnrichment = options?.skipEnrichment ?? false;
	}

	/**
	 * Build filters array from resource mapper fields
	 * Multiple fields are automatically combined with AND logic
	 */
	public buildFiltersFromResourceMapper(
		itemIndex: number,
		defaultFilter?: { field: string; op: string },
	): IAutotaskQueryInput<T>['filter'] {
		return buildFiltersFromResourceMapper<T>(this.context, itemIndex, defaultFilter);
	}

	/**
	 * Process response data into n8n format
	 */
	public processReturnData(items: T[]): INodeExecutionData[] {
		// Simply map items to INodeExecutionData format without any client-side filtering
		console.debug(`[GetManyOperation] Processing ${items.length} items from API response`);
		return items.map(item => ({ json: item }));
	}

	/**
	 * Execute get many operation with pagination
	 */
	async execute(filters: IAutotaskQueryInput<T>, itemIndex = 0): Promise<T[]> {
		return await handleErrors(
			this.context,
			async () => {
				// When this GetManyOperation is being used for picklist/reference queries we
				// must ignore the node-level pagination settings (returnAll / maxRecords) that
				// end-users configure for their primary entity request. Those settings would
				// otherwise bleed into this helper lookup and cap the result set (often at 10),
				// preventing reference-label enrichment for IDs beyond the cap.

				const isPicklistQuery = this.options?.isPicklistQuery === true;

				let returnAll = true;
				if (!isPicklistQuery) {
					// Respect the user parameters only for regular data queries
					returnAll = this.context.getNodeParameter('returnAll', itemIndex, true) as boolean;

					if (!returnAll) {
						const maxRecords = this.context.getNodeParameter('maxRecords', itemIndex, 10) as number;
						// Add MaxRecords to the filters object
						filters.MaxRecords = maxRecords;
					}
				}

				// Initialize results array
				let results: T[] = [];

				// Execute initial query
				const initialResponse = await this.executeQuery(filters, undefined);
				const initialResults = await this.paginationHandler.processResponse(initialResponse);
				results.push(...initialResults);

				// Only continue with pagination if returnAll is true
				if (returnAll) {
					// Handle pagination iteratively to prevent stack overflow
					while (this.paginationHandler.hasNextPage()) {
						const nextPageUrl = this.paginationHandler.getNextPageUrl();
						if (!nextPageUrl) {
							throw new Error(
								ERROR_TEMPLATES.operation
									.replace('{type}', 'PaginationError')
									.replace('{operation}', 'getMany')
									.replace('{entity}', this.entityType)
									.replace('{details}', 'Invalid next page URL')
							);
						}

						const pageResponse = await this.executeQuery(filters, nextPageUrl);
						const pageResults = await this.paginationHandler.processResponse(pageResponse);
						results.push(...pageResults);
					}
				}

				if (this.skipEnrichment) {
					return results;
				}

				// Get field processor instance for enrichment
				const fieldProcessor = FieldProcessor.getInstance(
					this.entityType,
					OperationType.READ,
					this.context,
				);

				// Check if reference labels should be added (must be processed before picklist labels)
				try {
					const addReferenceLabels = this.context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;

					if (addReferenceLabels && results.length > 0) {
						console.debug(`[GetManyOperation] Adding reference labels for ${results.length} ${this.entityType} entities`);
						// Enrich entities with reference labels
						results = await fieldProcessor.enrichWithReferenceLabels(results) as T[];
					}
				} catch (error) {
					// If parameter doesn't exist or there's an error, log it but don't fail the operation
					console.warn(`[GetManyOperation] Error processing reference labels: ${error.message}`);
				}

				// Check if picklist labels should be added
				try {
					const addPicklistLabels = this.context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;

					if (addPicklistLabels && results.length > 0) {
						console.debug(`[GetManyOperation] Adding picklist labels for ${results.length} ${this.entityType} entities`);
						// Enrich entities with picklist labels
						results = await fieldProcessor.enrichWithPicklistLabels(results) as T[];
					}
				} catch (error) {
					// If parameter doesn't exist or there's an error, log it but don't fail the operation
					console.warn(`[GetManyOperation] Error processing picklist labels: ${error.message}`);
				}

				// Process dates in response before returning
				try {
					const processedResults = await processResponseDatesArray.call(
						this.context,
						results,
						`${this.entityType}.getMany`,
					);

					// Check if UDFs should be flattened
					try {
						const shouldFlattenUdfs = this.context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;

						if (shouldFlattenUdfs) {
							console.debug(`[GetManyOperation] Flattening UDFs for ${processedResults.length} ${this.entityType} entities`);
							return flattenUdfsArray(processedResults as T[]);
						}
					} catch (error) {
						// If parameter doesn't exist or there's an error, log it but don't fail the operation
						console.warn(`[GetManyOperation] Error flattening UDFs: ${error.message}`);
					}

					return processedResults as T[];
				} catch (error) {
					console.warn(`[GetManyOperation] Error processing dates: ${error.message}`);

					// Check if UDFs should be flattened even though date processing failed
					try {
						const shouldFlattenUdfs = this.context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;

						if (shouldFlattenUdfs) {
							console.debug(`[GetManyOperation] Flattening UDFs for ${results.length} ${this.entityType} entities`);
							return flattenUdfsArray(results);
						}
					} catch (error) {
						// If parameter doesn't exist or there's an error, log it but don't fail the operation
						console.warn(`[GetManyOperation] Error flattening UDFs: ${error.message}`);
					}

					return results; // Return original if conversion fails
				}
			},
			{
				operation: 'getMany',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Execute a single query
	 */
	private async executeQuery(
		filters: IAutotaskQueryInput<T>,
		nextPageUrl?: string | null,
	): Promise<IQueryResponse<T>> {
		return await handleErrors(
			this.context,
			async () => {
				// Ensure filters.filter is initialized
				if (!filters.filter) {
					filters.filter = [];
				}

				// For pagination, use the complete nextPageUrl
				if (nextPageUrl) {
					const response = await autotaskApiRequest.call(
						this.context,
						'POST',
						nextPageUrl,
						filters as unknown as IDataObject,
					) as IQueryResponse<T>;

					if (!response) {
						throw new Error(
							ERROR_TEMPLATES.operation
								.replace('{type}', 'ResponseError')
								.replace('{operation}', 'query')
								.replace('{entity}', this.entityType)
								.replace('{details}', 'Empty response from API')
						);
					}

					return response;
				}

				// Initial query - construct endpoint
				let endpoint: string;
				if (this.entityType === 'UserDefinedFieldListItem') {
					// Special handling for UDF list items - use parent context
					const udfFieldId = filters.filter.find(f => f.field === 'udfFieldId')?.value;
					if (!udfFieldId) {
						throw new Error(
							ERROR_TEMPLATES.validation
								.replace('{type}', 'ValidationError')
								.replace('{entity}', this.entityType)
								.replace('{details}', 'UDF Field ID is required for querying list items')
						);
					}
					endpoint = buildChildEntityUrl('UserDefinedFieldDefinition', 'ListItem', udfFieldId as string | number, { isQuery: true });
				} else if (this.parentType) {
					// Check if this entity requires parent context for queries
					const metadata = getEntityMetadata(this.entityType);
					const requiresParentForQuery = metadata?.operations?.query === 'parent';

					if (requiresParentForQuery) {
						// Handle child entity queries that require parent context
						const parentId = filters.filter.find(f => f.field === `${(this.parentType as string).toLowerCase()}Id`)?.value;
						if (!parentId) {
							throw new Error(
								ERROR_TEMPLATES.validation
									.replace('{type}', 'ValidationError')
									.replace('{entity}', this.entityType)
									.replace('{details}', `${this.parentType} ID is required for querying child entities`)
							);
						}
						endpoint = buildChildEntityUrl(this.parentType, this.entityType, parentId as string | number, { isQuery: true });
					} else {
						// Entity supports direct queries
						endpoint = buildEntityUrl(this.entityType, { isQuery: true });
					}
				} else {
					// Standard entity query
					endpoint = buildEntityUrl(this.entityType, { isQuery: true });
				}

				// Ensure we have at least one filter condition
				if (filters.filter.length === 0) {
					filters.filter.push({
						op: FilterOperators.exist,
						field: 'id',
					});
				}

				// Get selected columns and picklist labels flag (for itemIndex 0 by default)
				const itemIndex = 0; // For non-paginated requests, use itemIndex 0 as default
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

				// Prepare query body
				const queryBody: IAutotaskQueryInput<T> = {
					filter: filters.filter,
				};

				// Include MaxRecords if specified
				if (filters.MaxRecords) {
					queryBody.MaxRecords = filters.MaxRecords;
				}

				// Check if this is a picklist query
				if (this.options?.isPicklistQuery) {
					// For picklist queries, don't specify IncludeFields to get all fields
					// This avoids issues with incorrect fields being included
					console.debug(`[GetManyOperation] Picklist query detected for ${this.entityType} - not using IncludeFields`);
				} else {
					// For regular queries, add IncludeFields if there are specific fields to include
					if (includeFields.length > 0) {
						queryBody.IncludeFields = includeFields;
						console.debug(`[GetManyOperation] Using IncludeFields with ${includeFields.length} fields for query`);
					}
				}

				const response = await autotaskApiRequest.call(
					this.context,
					'POST',
					endpoint,
					queryBody as unknown as IDataObject,
				) as IQueryResponse<T>;

				if (!response) {
					throw new Error(
						ERROR_TEMPLATES.operation
							.replace('{type}', 'ResponseError')
							.replace('{operation}', 'query')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Empty response from API')
					);
				}

				return response;
			},
			{
				operation: 'query',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Reset pagination state
	 */
	reset(): void {
		this.paginationHandler.reset();
	}
}
