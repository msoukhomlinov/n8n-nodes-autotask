import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import { buildFiltersFromResourceMapper } from '../../helpers/filter';
import { FilterOperators } from '../../constants/filters';
import { BaseOperation } from './base-operation';

/**
 * Base class for counting entities
 * Extends BaseOperation to handle both direct and indirect parent-child relationships
 */
export class CountOperation<T extends IAutotaskEntity> extends BaseOperation {
	constructor(
		entityType: string,
		context: IExecuteFunctions,
	) {
		// Get metadata to check if this is a child entity that requires parent context
		const metadata = getEntityMetadata(entityType);
		const parentType = metadata?.operations?.count === 'parent' ? metadata.childOf : undefined;

		super(entityType, OperationType.COUNT, context, parentType);
	}

	/**
	 * Execute count operation
	 */
	async execute(itemIndex: number): Promise<number> {
		return await handleErrors(
			this.context,
			async () => {
				// Always use /query/count endpoint for all count operations
				const endpoint = await this.buildOperationUrl(itemIndex, { isQuery: true, isCount: true });
				console.debug('[CountOperation] Using endpoint:', endpoint);

				// Build filters from resource mapper
				const queryFilters = buildFiltersFromResourceMapper<T>(this.context, itemIndex);

				// Ensure we have at least one filter condition
				if (queryFilters.length === 0) {
					queryFilters.push({
						op: FilterOperators.exist,
						field: 'id',
					});
				}

				// Always use POST for count operations
				const response = await autotaskApiRequest.call(
					this.context,
					'POST',
					endpoint,
					{ filter: queryFilters }
				);

				// Validate response format
				if (response === null || response === undefined) {
					throw new Error(`Invalid count response: response is ${response}`);
				}

				if (typeof response !== 'object') {
					throw new Error(`Invalid count response: expected object, got ${typeof response}`);
				}

				if (!('queryCount' in response)) {
					throw new Error(`Invalid count response: missing queryCount property. Response: ${JSON.stringify(response)}`);
				}

				const count = response.queryCount;
				if (typeof count !== 'number') {
					throw new Error(`Invalid count response: queryCount is not a number. Count: ${count}`);
				}

				return count;
			},
			{
				operation: 'count',
				entityType: this.entityType,
			},
		);
	}
}
