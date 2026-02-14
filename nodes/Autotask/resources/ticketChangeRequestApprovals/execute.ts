import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput, IQueryResponse } from '../../types';
import {
    CountOperation,
    CreateOperation,
    DeleteOperation,
    GetManyOperation,
    GetOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';
import { buildFiltersFromResourceMapper } from '../../helpers/filter';
import { FilterOperators } from '../../constants/filters';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http';
import { getSelectedColumns, prepareIncludeFields } from '../../operations/common/select-columns';
import { processOutputMode } from '../../helpers/output-mode';
import { processResponseDates, processResponseDatesArray } from '../../helpers/date-time';
import { flattenUdfsArray } from '../../helpers/udf/flatten';

const ENTITY_TYPE = 'ticketChangeRequestApproval';

type EndpointScope = 'root' | 'ticketChild';
type QueryInput = IAutotaskQueryInput<IAutotaskEntity>;

function getEndpointScope(context: IExecuteFunctions, itemIndex: number): EndpointScope {
    return context.getNodeParameter('endpointScope', itemIndex, 'root') as EndpointScope;
}

function getTicketId(context: IExecuteFunctions, itemIndex: number): string | number {
    const ticketID = context.getNodeParameter('ticketID', itemIndex) as string;
    if (!ticketID) {
        throw new Error('Ticket ID is required when Endpoint Scope is Ticket Child');
    }
    return ticketID;
}

function buildChildBasePath(ticketID: string | number): string {
    return `Tickets/${ticketID}/ChangeRequestApprovals`;
}

async function executeCreateWithChildTicket(
    context: IExecuteFunctions,
    itemIndex: number,
    ticketID: string | number,
): Promise<IAutotaskEntity> {
    const originalGetNodeParameter = context.getNodeParameter;

    context.getNodeParameter = ((name, index, fallbackValue, options) => {
        if (name !== 'fieldsToMap') {
            return originalGetNodeParameter.call(context, name, index, fallbackValue, options);
        }

        const existing = originalGetNodeParameter.call(
            context,
            'fieldsToMap',
            index,
            { mappingMode: 'defineBelow', value: {} },
            options,
        ) as { mappingMode?: string; value?: Record<string, unknown> };

        return {
            mappingMode: existing?.mappingMode ?? 'defineBelow',
            value: {
                ...(existing?.value ?? {}),
                ticketID,
            },
        };
    }) as typeof context.getNodeParameter;

    try {
        const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, context);
        return await createOp.execute(itemIndex);
    } finally {
        context.getNodeParameter = originalGetNodeParameter;
    }
}

function getIncludeFields(context: IExecuteFunctions, itemIndex: number): string[] {
    const selectedColumns = getSelectedColumns(context, itemIndex);
    let addPicklistLabels = false;
    let addReferenceLabels = false;

    try {
        addPicklistLabels = context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;
    } catch {
        addPicklistLabels = false;
    }

    try {
        addReferenceLabels = context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;
    } catch {
        addReferenceLabels = false;
    }

    return prepareIncludeFields(selectedColumns, { addPicklistLabels, addReferenceLabels });
}

async function executeScopedQuery(
    context: IExecuteFunctions,
    itemIndex: number,
    endpoint: string,
    queryBody: QueryInput,
): Promise<IAutotaskEntity[]> {
    const returnAll = context.getNodeParameter('returnAll', itemIndex, true) as boolean;
    if (!returnAll && !queryBody.MaxRecords) {
        queryBody.MaxRecords = context.getNodeParameter('maxRecords', itemIndex, 10) as number;
    }

    const response = await autotaskApiRequest.call(
        context,
        'POST',
        endpoint,
        queryBody as unknown as IDataObject,
    ) as IQueryResponse<IAutotaskEntity>;

    const results = [...(response.items ?? [])];
    let nextPageUrl = response.pageDetails?.nextPageUrl;

    if (returnAll) {
        while (nextPageUrl) {
            const nextResponse = await autotaskApiRequest.call(
                context,
                'POST',
                nextPageUrl,
                queryBody as unknown as IDataObject,
            ) as IQueryResponse<IAutotaskEntity>;
            results.push(...(nextResponse.items ?? []));
            nextPageUrl = nextResponse.pageDetails?.nextPageUrl;
        }
    }

    const withOutputMode = await processOutputMode(results, ENTITY_TYPE, context, itemIndex) as IAutotaskEntity[];
    const withDates = await processResponseDatesArray.call(
        context,
        withOutputMode,
        `${ENTITY_TYPE}.getMany`,
    ) as IAutotaskEntity[];

    const shouldFlattenUdfs = context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;
    return shouldFlattenUdfs ? flattenUdfsArray(withDates) : withDates;
}

function parseAdvancedFilter(context: IExecuteFunctions, itemIndex: number): QueryInput {
    const advancedFilter = context.getNodeParameter('advancedFilter', itemIndex) as string | QueryInput;
    const queryInput = typeof advancedFilter === 'string'
        ? JSON.parse(advancedFilter) as QueryInput
        : advancedFilter;

    if (!queryInput.filter || !Array.isArray(queryInput.filter)) {
        throw new Error('Advanced filter must contain a "filter" array');
    }

    if (!queryInput.IncludeFields || !Array.isArray(queryInput.IncludeFields)) {
        const includeFields = getIncludeFields(context, itemIndex);
        if (includeFields.length > 0) {
            queryInput.IncludeFields = includeFields;
        }
    } else if (!queryInput.IncludeFields.includes('id')) {
        queryInput.IncludeFields.push('id');
    }

    return queryInput;
}

export async function executeTicketChangeRequestApprovalOperation(
    this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
        try {
            const endpointScope = getEndpointScope(this, i);
            const isChildScope = endpointScope === 'ticketChild';

            switch (operation) {
                case 'create': {
                    if (!isChildScope) {
                        throw new Error('Create is only supported when Endpoint Scope is Ticket Child');
                    }
                    const ticketID = getTicketId(this, i);
                    const response = await executeCreateWithChildTicket(this, i, ticketID);
                    returnData.push({ json: response });
                    break;
                }

                case 'delete': {
                    if (!isChildScope) {
                        throw new Error('Delete is only supported when Endpoint Scope is Ticket Child');
                    }
                    const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                    const response = await deleteOp.execute(i);
                    returnData.push({ json: (response ?? { success: true }) as IDataObject });
                    break;
                }

                case 'get': {
                    if (!isChildScope) {
                        const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                        const response = await getOp.execute(i);
                        returnData.push({ json: response });
                        break;
                    }

                    const ticketID = getTicketId(this, i);
                    const entityId = this.getNodeParameter('id', i) as string | number;
                    const includeFields = getIncludeFields(this, i);
                    const queryBody: QueryInput = {
                        filter: [{ field: 'id', op: FilterOperators.eq, value: entityId }],
                        MaxRecords: 1,
                    };
                    if (includeFields.length > 0) {
                        queryBody.IncludeFields = includeFields;
                    }

                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(ticketID)}/query`,
                        queryBody,
                    );
                    if (results.length === 0) {
                        throw new Error(`Ticket change request approval with ID ${entityId} was not found`);
                    }

                    const withDates = await processResponseDates.call(this, results[0], `${ENTITY_TYPE}.get`);
                    returnData.push({ json: withDates as IDataObject });
                    break;
                }

                case 'getMany': {
                    if (!isChildScope) {
                        const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                        const filters = await getManyOp.buildFiltersFromResourceMapper(i);
                        const response = await getManyOp.execute({ filter: filters }, i);
                        returnData.push(...getManyOp.processReturnData(response));
                        break;
                    }

                    const ticketID = getTicketId(this, i);
                    const filters = await buildFiltersFromResourceMapper<IAutotaskEntity>(
                        this,
                        i,
                        ENTITY_TYPE,
                        OperationType.READ,
                    );
                    const includeFields = getIncludeFields(this, i);
                    const queryBody: QueryInput = { filter: filters };
                    if (includeFields.length > 0) {
                        queryBody.IncludeFields = includeFields;
                    }

                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(ticketID)}/query`,
                        queryBody,
                    );
                    returnData.push(...results.map(item => ({ json: item })));
                    break;
                }

                case 'getManyAdvanced': {
                    if (!isChildScope) {
                        const response = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
                        returnData.push(...response);
                        break;
                    }

                    const ticketID = getTicketId(this, i);
                    const queryBody = parseAdvancedFilter(this, i);
                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(ticketID)}/query`,
                        queryBody,
                    );
                    returnData.push(...results.map(item => ({ json: item })));
                    break;
                }

                case 'count': {
                    if (!isChildScope) {
                        const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                        const count = await countOp.execute(i);
                        returnData.push({
                            json: {
                                count,
                                entityType: ENTITY_TYPE,
                            },
                        });
                        break;
                    }

                    const ticketID = getTicketId(this, i);
                    const filters = await buildFiltersFromResourceMapper<IAutotaskEntity>(
                        this,
                        i,
                        ENTITY_TYPE,
                        OperationType.COUNT,
                        { field: 'id', op: FilterOperators.exist },
                    );
                    const response = await autotaskApiRequest.call(
                        this,
                        'POST',
                        `${buildChildBasePath(ticketID)}/query/count`,
                        { filter: filters } as IDataObject,
                    ) as { queryCount: number };

                    returnData.push({
                        json: {
                            count: response.queryCount,
                            entityType: ENTITY_TYPE,
                        },
                    });
                    break;
                }

                case 'getEntityInfo':
                case 'getFieldInfo': {
                    const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
                    returnData.push(response);
                    break;
                }

                default:
                    throw new Error(`Operation ${operation} is not supported`);
            }
        } catch (error) {
            if (this.continueOnFail()) {
                returnData.push({ json: { error: error.message } });
                continue;
            }
            throw error;
        }
    }

    return [returnData];
}
