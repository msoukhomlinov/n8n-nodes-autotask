import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../../types';
import type { IFilterCondition } from '../../types/base/entity-types';
import { GetManyOperation } from './get-many';
import { BaseOperation } from './base-operation';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { OperationType } from '../../types/base/entity-types';

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
		this.getManyOp = new GetManyOperation<T>(entityType, context, options);
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
		try {
			const queryInput = await this.parseAdvancedFilter(itemIndex);

			// Execute query with pagination
			const results = await this.getManyOp.execute(queryInput, itemIndex);

			return results;
		} catch (error) {
			throw new Error(
				ERROR_TEMPLATES.operation
					.replace('{type}', 'AdvancedQueryError')
					.replace('{operation}', 'getManyAdvanced')
					.replace('{entity}', this.entityType)
					.replace('{details}', error.message),
			);
		}
	}
}
