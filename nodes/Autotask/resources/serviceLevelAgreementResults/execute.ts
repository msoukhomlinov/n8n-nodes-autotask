import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
    CountOperation,
    GetManyOperation,
    GetOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';
import { buildFiltersFromResourceMapper } from '../../helpers/filter';
import { FilterOperators } from '../../constants/filters';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http';
import { processResponseDates } from '../../helpers/date-time';
import {
    getIncludeFields,
    executeScopedQuery,
    parseAdvancedFilter,
    executeChildEntityInfoOperation,
    executeChildFieldInfoOperation,
} from '../../operations/common/scoped-query';

const ENTITY_TYPE = 'serviceLevelAgreementResults';

function getServiceLevelAgreementId(context: IExecuteFunctions, itemIndex: number): string | number | undefined {
    const serviceLevelAgreementID = context.getNodeParameter('serviceLevelAgreementID', itemIndex, '') as string;
    const normalizedId = String(serviceLevelAgreementID).trim();
    return normalizedId.length > 0 ? normalizedId : undefined;
}

function buildChildBasePath(serviceLevelAgreementID: string | number): string {
    return `ServiceLevelAgreements/${serviceLevelAgreementID}/Results`;
}

export async function executeServiceLevelAgreementResultOperation(
    this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
        try {
            const serviceLevelAgreementID = getServiceLevelAgreementId(this, i);
            const isChildScope = serviceLevelAgreementID !== undefined;

            switch (operation) {
                case 'get': {
                    if (!isChildScope) {
                        const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                        const response = await getOp.execute(i);
                        returnData.push({ json: response });
                        break;
                    }

                    const entityId = this.getNodeParameter('id', i) as string | number;
                    const includeFields = getIncludeFields(this, i);
                    const queryBody = {
                        filter: [{ field: 'id', op: FilterOperators.eq, value: entityId }],
                        MaxRecords: 1 as number | undefined,
                        IncludeFields: undefined as string[] | undefined,
                    };
                    if (includeFields.length > 0) {
                        queryBody.IncludeFields = includeFields;
                    }

                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
                        queryBody,
                        ENTITY_TYPE,
                    );

                    if (results.length === 0) {
                        throw new Error(`Service level agreement result with ID ${entityId} was not found`);
                    }

                    const withDates = await processResponseDates.call(
                        this,
                        results[0],
                        `${ENTITY_TYPE}.get`,
                    );
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

                    const filters = await buildFiltersFromResourceMapper<IAutotaskEntity>(
                        this,
                        i,
                        ENTITY_TYPE,
                        OperationType.READ,
                    );
                    const includeFields = getIncludeFields(this, i);
                    const queryBody = { filter: filters, IncludeFields: undefined as string[] | undefined };
                    if (includeFields.length > 0) {
                        queryBody.IncludeFields = includeFields;
                    }

                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
                        queryBody,
                        ENTITY_TYPE,
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

                    const queryBody = parseAdvancedFilter(this, i);
                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
                        queryBody,
                        ENTITY_TYPE,
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
                        `${buildChildBasePath(serviceLevelAgreementID)}/query/count`,
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

                case 'getEntityInfo': {
                    if (!isChildScope) {
                        const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
                        returnData.push(response);
                        break;
                    }

                    const response = await executeChildEntityInfoOperation(
                        this,
                        ENTITY_TYPE,
                        buildChildBasePath(serviceLevelAgreementID),
                    );
                    returnData.push(response);
                    break;
                }

                case 'getFieldInfo': {
                    if (!isChildScope) {
                        const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
                        returnData.push(response);
                        break;
                    }

                    const response = await executeChildFieldInfoOperation(
                        this,
                        ENTITY_TYPE,
                        buildChildBasePath(serviceLevelAgreementID),
                    );
                    returnData.push(response);
                    break;
                }

                default:
                    throw new Error(`Operation ${operation} is not supported`);
            }
        } catch (error) {
            if (this.continueOnFail()) {
                returnData.push({ json: { error: (error as Error).message } });
                continue;
            }
            throw error;
        }
    }

    return [returnData];
}
