import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput, IQueryResponse } from '../../types';
import type { IEntityField } from '../../types/base/entities';
import { autotaskApiRequest } from '../../helpers/http';
import { getSelectedColumns, prepareIncludeFields } from './select-columns';
import { processOutputMode } from '../../helpers/output-mode';
import { processResponseDatesArray } from '../../helpers/date-time';
import { flattenUdfsArray } from '../../helpers/udf/flatten';
import { getEntityMetadata } from '../../constants/entities';

type QueryInput = IAutotaskQueryInput<IAutotaskEntity>;

export function getIncludeFields(context: IExecuteFunctions, itemIndex: number): string[] {
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

export async function executeScopedQuery(
    context: IExecuteFunctions,
    itemIndex: number,
    endpoint: string,
    queryBody: QueryInput,
    entityType: string,
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
        entityType,
        context,
        itemIndex,
    ) as IAutotaskEntity[];
    const withDates = await processResponseDatesArray.call(
        context,
        withOutputMode,
        `${entityType}.getMany`,
    ) as IAutotaskEntity[];

    const shouldFlattenUdfs = context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;
    return shouldFlattenUdfs ? flattenUdfsArray(withDates) : withDates;
}

export function parseAdvancedFilter(context: IExecuteFunctions, itemIndex: number): QueryInput {
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

export function processStandardFields(fields: IEntityField[]): IEntityField[] {
    return fields.map(field => ({
        ...field,
        isUdf: false,
        isSystemField: field.isSystemField || false,
    }));
}

export function processUdfFields(fields: IEntityField[]): IEntityField[] {
    return fields.map(field => ({
        ...field,
        isUdf: true,
        isSystemField: false,
    }));
}

export async function executeChildEntityInfoOperation(
    context: IExecuteFunctions,
    entityType: string,
    childBasePath: string,
): Promise<INodeExecutionData> {
    const metadata = getEntityMetadata(entityType);
    if (!metadata) {
        throw new Error(`Entity metadata not found for ${entityType}`);
    }

    const endpoint = `${childBasePath}/entityInformation`;
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
            name: entityType,
            metadata: {
                ...metadata,
            },
            apiInfo: response.info,
        },
    };
}

export async function executeChildFieldInfoOperation(
    context: IExecuteFunctions,
    entityType: string,
    childBasePath: string,
): Promise<INodeExecutionData> {
    const metadata = getEntityMetadata(entityType);
    if (!metadata) {
        throw new Error(`Entity metadata not found for ${entityType}`);
    }

    const entityInfoResponse = await autotaskApiRequest.call(
        context,
        'GET',
        `${childBasePath}/entityInformation`,
    ) as { info: { hasUserDefinedFields?: boolean; supportsWebhookCallouts?: boolean } };

    const standardFieldsResponse = await autotaskApiRequest.call(
        context,
        'GET',
        `${childBasePath}/entityInformation/fields`,
    ) as { fields: IEntityField[] };

    if (!Array.isArray(standardFieldsResponse?.fields)) {
        throw new Error('Invalid standard fields response format');
    }

    let udfFields: IEntityField[] = [];
    if (entityInfoResponse?.info?.hasUserDefinedFields) {
        const udfFieldsResponse = await autotaskApiRequest.call(
            context,
            'GET',
            `${childBasePath}/entityInformation/userDefinedFields`,
        ) as { fields: IEntityField[] };

        udfFields = Array.isArray(udfFieldsResponse?.fields) ? udfFieldsResponse.fields : [];
    }

    const standardFields = processStandardFields(standardFieldsResponse.fields);
    const processedUdfFields = processUdfFields(udfFields);
    const allFields = [...standardFields, ...processedUdfFields];

    return {
        json: {
            name: entityType,
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
