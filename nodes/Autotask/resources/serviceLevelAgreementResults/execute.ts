import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput, IQueryResponse } from '../../types';
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
import { getSelectedColumns, prepareIncludeFields } from '../../operations/common/select-columns';
import { processOutputMode } from '../../helpers/output-mode';
import { processResponseDates, processResponseDatesArray } from '../../helpers/date-time';
import { flattenUdfsArray } from '../../helpers/udf/flatten';
import { getEntityMetadata } from '../../constants/entities';
import type { IEntityField } from '../../types/base/entities';

const ENTITY_TYPE = 'serviceLevelAgreementResults';

type QueryInput = IAutotaskQueryInput<IAutotaskEntity>;

function getServiceLevelAgreementId(context: IExecuteFunctions, itemIndex: number): string | number | undefined {
    const serviceLevelAgreementID = context.getNodeParameter('serviceLevelAgreementID', itemIndex, '') as string;
    const normalizedId = String(serviceLevelAgreementID).trim();
    return normalizedId.length > 0 ? normalizedId : undefined;
}

function buildChildBasePath(serviceLevelAgreementID: string | number): string {
    return `ServiceLevelAgreements/${serviceLevelAgreementID}/Results`;
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

    const withOutputMode = await processOutputMode(
        results,
        ENTITY_TYPE,
        context,
        itemIndex,
    ) as IAutotaskEntity[];
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

function processStandardFields(fields: IEntityField[]): IEntityField[] {
    return fields.map(field => ({
        ...field,
        isUdf: false,
        isSystemField: field.isSystemField || false,
    }));
}

function processUdfFields(fields: IEntityField[]): IEntityField[] {
    return fields.map(field => ({
        ...field,
        isUdf: true,
        isSystemField: false,
    }));
}

async function executeChildEntityInfoOperation(
    context: IExecuteFunctions,
    itemIndex: number,
    serviceLevelAgreementID: string | number,
): Promise<INodeExecutionData> {
    const metadata = getEntityMetadata(ENTITY_TYPE);
    if (!metadata) {
        throw new Error(`Entity metadata not found for ${ENTITY_TYPE}`);
    }

    const endpoint = `${buildChildBasePath(serviceLevelAgreementID)}/entityInformation`;
    const response = await autotaskApiRequest.call(
        context,
        'GET',
        endpoint,
    ) as { info: IDataObject };

    if (!response?.info || typeof response.info !== 'object') {
        throw new Error('Invalid entity info response format');
    }

    return {
        json: {
            name: ENTITY_TYPE,
            metadata: {
                ...metadata,
            },
            apiInfo: response.info,
        },
    };
}

async function executeChildFieldInfoOperation(
    context: IExecuteFunctions,
    itemIndex: number,
    serviceLevelAgreementID: string | number,
): Promise<INodeExecutionData> {
    const metadata = getEntityMetadata(ENTITY_TYPE);
    if (!metadata) {
        throw new Error(`Entity metadata not found for ${ENTITY_TYPE}`);
    }

    const entityInfoResponse = await autotaskApiRequest.call(
        context,
        'GET',
        `${buildChildBasePath(serviceLevelAgreementID)}/entityInformation`,
    ) as { info: { hasUserDefinedFields?: boolean; supportsWebhookCallouts?: boolean } };

    const standardFieldsResponse = await autotaskApiRequest.call(
        context,
        'GET',
        `${buildChildBasePath(serviceLevelAgreementID)}/entityInformation/fields`,
    ) as { fields: IEntityField[] };

    if (!Array.isArray(standardFieldsResponse?.fields)) {
        throw new Error('Invalid standard fields response format');
    }

    let udfFields: IEntityField[] = [];
    if (entityInfoResponse?.info?.hasUserDefinedFields) {
        const udfFieldsResponse = await autotaskApiRequest.call(
            context,
            'GET',
            `${buildChildBasePath(serviceLevelAgreementID)}/entityInformation/userDefinedFields`,
        ) as { fields: IEntityField[] };

        udfFields = Array.isArray(udfFieldsResponse?.fields) ? udfFieldsResponse.fields : [];
    }

    const standardFields = processStandardFields(standardFieldsResponse.fields);
    const processedUdfFields = processUdfFields(udfFields);
    const allFields = [...standardFields, ...processedUdfFields];

    return {
        json: {
            name: ENTITY_TYPE,
            metadata: {
                ...metadata,
                hasUserDefinedFields: entityInfoResponse?.info?.hasUserDefinedFields ?? false,
                supportsWebhookCallouts: entityInfoResponse?.info?.supportsWebhookCallouts ?? false,
            },
            standardFields,
            udfFields: processedUdfFields,
            allFields,
        },
    };
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
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
                        queryBody,
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
                    const queryBody: QueryInput = { filter: filters };
                    if (includeFields.length > 0) {
                        queryBody.IncludeFields = includeFields;
                    }

                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
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

                    const queryBody = parseAdvancedFilter(this, i);
                    const results = await executeScopedQuery(
                        this,
                        i,
                        `${buildChildBasePath(serviceLevelAgreementID)}/query`,
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

                    const response = await executeChildEntityInfoOperation(this, i, serviceLevelAgreementID);
                    returnData.push(response);
                    break;
                }

                case 'getFieldInfo': {
                    if (!isChildScope) {
                        const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
                        returnData.push(response);
                        break;
                    }

                    const response = await executeChildFieldInfoOperation(this, i, serviceLevelAgreementID);
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
