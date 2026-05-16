import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskQueryInput, IAutotaskEntity } from '../../types';
import type { IFilterCondition } from '../../types/base/entity-types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import { BaseOperation } from './base-operation';

export class CountAdvancedOperation<T extends IAutotaskEntity> extends BaseOperation {
    constructor(entityType: string, context: IExecuteFunctions) {
        const metadata = getEntityMetadata(entityType);
        const parentType = metadata?.operations?.count === 'parent' ? metadata.childOf : undefined;
        super(entityType, OperationType.COUNT, context, parentType);
    }

    private async parseAdvancedFilter(itemIndex: number): Promise<IAutotaskQueryInput<T>> {
        const advancedFilter = await this.getParameter('advancedFilter', itemIndex);

        try {
            const queryInput = typeof advancedFilter === 'string' ? JSON.parse(advancedFilter) : advancedFilter;

            if (!queryInput.filter || !Array.isArray(queryInput.filter)) {
                throw new Error('Advanced filter must contain a "filter" array');
            }

            // Validate filter conditions recursively (supports and/or group conditions)
            const validateFilter = (filter: IFilterCondition): void => {
                if (filter.items) {
                    if (!['and', 'or'].includes(filter.op)) {
                        throw new Error('Group operator must be "and" or "or"');
                    }
                    for (const item of filter.items) {
                        validateFilter(item);
                    }
                } else {
                    if (!filter.field || !filter.op) {
                        throw new Error('Each filter condition must have a field and operator');
                    }
                }
            };

            for (const filterItem of queryInput.filter) {
                validateFilter(filterItem);
            }

            return queryInput;
        } catch (error) {
            if (error instanceof SyntaxError) {
                // eslint-disable-next-line @n8n/community-nodes/require-node-api-error
                throw new Error(`Invalid JSON in advanced filter: ${error.message}`);
            }
            // eslint-disable-next-line @n8n/community-nodes/require-node-api-error
            throw error;
        }
    }

    async execute(itemIndex = 0): Promise<number> {
        return await handleErrors(
            this.context,
            async () => {
                const queryInput = await this.parseAdvancedFilter(itemIndex);
                const endpoint = await this.buildOperationUrl(itemIndex, { isQuery: true, isCount: true });

                const response = await autotaskApiRequest.call(
                    this.context,
                    'POST',
                    endpoint,
                    { filter: queryInput.filter },
                );

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
                operation: 'countAdvanced',
                entityType: this.entityType,
            },
        );
    }
}
