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

/**
 * Base class for retrieving multiple entities
 */
export class GetManyOperation<T extends IAutotaskEntity> {
	private readonly paginationHandler: PaginationHandler;
	private readonly parentType?: string;

	constructor(
		private readonly entityType: string,
		private readonly context: IExecuteFunctions,
		options?: {
			pageSize?: number;
			maxPages?: number;
			isPicklistQuery?: boolean;
			picklistFields?: string[];
			parentType?: string;
		},
	) {
		this.paginationHandler = new PaginationHandler(entityType, context, options);
		this.parentType = options?.parentType;
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
		return items.map(item => ({ json: item }));
	}

	/**
	 * Execute get many operation with pagination
	 */
	async execute(filters: IAutotaskQueryInput<T>, itemIndex = 0): Promise<T[]> {
		return await handleErrors(
			this.context,
			async () => {
				// Check if returnAll is false, if so, get the maxRecords parameter
				const returnAll = this.context.getNodeParameter('returnAll', itemIndex, true) as boolean;
				if (!returnAll) {
					const maxRecords = this.context.getNodeParameter('maxRecords', itemIndex, 10) as number;
					// Add MaxRecords to the filters object
					filters.MaxRecords = maxRecords;
				}

				// Initialize results array
				const results: T[] = [];

				// Execute initial query
				const initialResults = await this.executeQuery(filters, undefined);
				results.push(...initialResults);

				// Only continue with pagination if returnAll is true
				if (returnAll) {
					// Handle pagination
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

						const pageResults = await this.executeQuery(filters, nextPageUrl);
						results.push(...pageResults);
					}
				}

				return results;
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
	): Promise<T[]> {
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

					return await this.paginationHandler.processResponse(response);
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

				// Prepare query body
				const queryBody: IAutotaskQueryInput<T> = {
					filter: filters.filter,
				};

				// Include MaxRecords if specified
				if (filters.MaxRecords) {
					queryBody.MaxRecords = filters.MaxRecords;
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

				return await this.paginationHandler.processResponse(response);
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
