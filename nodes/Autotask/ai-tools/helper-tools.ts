import { DynamicStructuredTool } from '@langchain/core/tools';
import type { IExecuteFunctions } from 'n8n-workflow';
import { describeResource, listPicklistValues, type DescribeResourceResponse } from '../helpers/aiHelper';
import { buildDescribeFieldsDescription, buildListPicklistValuesDescription } from './description-builders';
import {
    getDescribeFieldsJsonSchema,
    getListPicklistValuesJsonSchema,
} from './schema-generator';
import { formatApiError } from './error-formatter';
import { normaliseToolInputSchema } from './schema-normalizer';

interface DescribeFieldsParams {
    mode?: 'read' | 'write';
}

interface ListPicklistValuesParams {
    fieldId: string;
    query?: string;
    limit?: number;
    page?: number;
}

function compactDescribeResponse(response: DescribeResourceResponse): Record<string, unknown> {
    return {
        resource: response.resource,
        mode: response.mode,
        timezone: response.timezone,
        fields: response.fields.map((field) => ({
            id: field.id,
            type: field.type,
            required: field.required,
            isPickList: field.isPickList,
            isReference: field.isReference,
        })),
        notes: response.notes ?? [],
    };
}

export function buildHelperTools(
    resource: string,
    resourceLabel: string,
    context: IExecuteFunctions,
): DynamicStructuredTool[] {
    const describeFieldsTool = new DynamicStructuredTool({
        name: `autotask_${resource}_describeFields`,
        description: buildDescribeFieldsDescription(resourceLabel),
        // Use explicit JSON Schema with guaranteed root type: "object".
        schema: normaliseToolInputSchema(getDescribeFieldsJsonSchema()),
        func: async (params: Record<string, unknown>) => {
            try {
                const typedParams = params as DescribeFieldsParams;
                const mode = typedParams.mode ?? 'read';
                const result = await describeResource(context, resource, mode);
                return JSON.stringify(compactDescribeResponse(result));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return JSON.stringify(formatApiError(message, resource, 'describeFields'));
            }
        },
    });

    const listPicklistValuesTool = new DynamicStructuredTool({
        name: `autotask_${resource}_listPicklistValues`,
        description: buildListPicklistValuesDescription(resourceLabel),
        // Use explicit JSON Schema with guaranteed root type: "object".
        schema: normaliseToolInputSchema(getListPicklistValuesJsonSchema()),
        func: async (params: Record<string, unknown>) => {
            try {
                const typedParams = params as unknown as ListPicklistValuesParams;
                const result = await listPicklistValues(
                    context,
                    resource,
                    typedParams.fieldId,
                    typedParams.query,
                    typedParams.limit ?? 50,
                    typedParams.page ?? 1,
                );
                return JSON.stringify(result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return JSON.stringify(formatApiError(message, resource, 'listPicklistValues'));
            }
        },
    });

    return [describeFieldsTool, listPicklistValuesTool];
}
