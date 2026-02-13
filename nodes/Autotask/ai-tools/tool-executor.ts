import type { IExecuteFunctions, IGetNodeParameterOptions } from 'n8n-workflow';
import { executeToolOperation } from '../resources/tool/execute';
import { mapFilterOp } from './schema-generator';

export interface ToolExecutorParams {
    resource: string;
    operation: string;
    id?: number;
    filter_field?: string;
    filter_op?: string;
    filter_value?: string;
    filter_field_2?: string;
    filter_op_2?: string;
    filter_value_2?: string;
    limit?: number;
    fields?: string;
    [key: string]: string | number | boolean | undefined;
}

/** Maximum records to include in a single tool response before truncation */
const MAX_RESPONSE_RECORDS = 25;

/**
 * Build Autotask filter array from flat getMany/count params.
 * Supports two filter triplets for compound queries.
 */
function buildFilterFromParams(
    params: ToolExecutorParams,
): Array<{ field: string; op: string; value: string | number }> {
    const filters: Array<{ field: string; op: string; value: string | number }> = [];

    // First filter
    if (params.filter_field && params.filter_value !== undefined && params.filter_value !== '') {
        filters.push({
            field: params.filter_field,
            op: mapFilterOp(params.filter_op || 'eq'),
            value: params.filter_value,
        });
    }

    // Second filter
    if (params.filter_field_2 && params.filter_value_2 !== undefined && params.filter_value_2 !== '') {
        filters.push({
            field: params.filter_field_2,
            op: mapFilterOp(params.filter_op_2 || 'eq'),
            value: params.filter_value_2,
        });
    }

    return filters;
}

/**
 * Build field values for create/update from params.
 * Only includes actual entity field values, excluding control params.
 */
function buildFieldValues(
    params: ToolExecutorParams,
    excludeKeys: string[],
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const exclude = new Set([
        ...excludeKeys,
        'resource',
        'operation',
        'filter_field',
        'filter_op',
        'filter_value',
        'filter_field_2',
        'filter_op_2',
        'filter_value_2',
        'limit',
        'fields',
    ]);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '' && !exclude.has(key)) {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Parse the 'fields' param into a selectColumns-compatible array.
 */
function parseFieldsParam(fields: string | undefined): string[] {
    if (!fields || typeof fields !== 'string') return [];
    return fields
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
}

/**
 * Execute an Autotask operation by routing to the existing tool executor
 * with getNodeParameter overridden to map flat AI tool params.
 */
export async function executeAiTool(
    context: IExecuteFunctions,
    resource: string,
    operation: string,
    params: ToolExecutorParams,
): Promise<string> {
    const originalGetNodeParameter = context.getNodeParameter.bind(context);

    const fieldValues = buildFieldValues(params, ['id']);
    const filters = buildFilterFromParams(params);
    const entityId = params.id !== undefined ? String(params.id) : '';
    const selectedColumns = parseFieldsParam(params.fields);

    context.getNodeParameter = ((
        name: string,
        index: number,
        fallbackValue?: unknown,
        options?: IGetNodeParameterOptions,
    ): unknown => {
        switch (name) {
            case 'resource':
                return resource;
            case 'operation':
                return operation;
            case 'id':
                return entityId;
            case 'targetOperation':
                return `${resource}.${operation}`;
            case 'entityId':
                return entityId;
            case 'requestData': {
                const data: Record<string, unknown> =
                    ['getMany', 'count'].includes(operation) && filters.length > 0
                        ? { filter: filters }
                        : Object.keys(fieldValues).length > 0
                            ? fieldValues
                            : {};
                if (['getMany', 'count'].includes(operation) && params.limit !== undefined) {
                    data.limit = params.limit;
                }
                return JSON.stringify(data);
            }
            case 'fieldsToMap':
                if (['create', 'update'].includes(operation) && Object.keys(fieldValues).length > 0) {
                    return { mappingMode: 'defineBelow', value: fieldValues };
                }
                if (['getMany', 'count'].includes(operation) && filters.length > 0) {
                    const value: Record<string, string | number> = {};
                    for (const f of filters) {
                        value[f.field] = f.value;
                    }
                    return { value };
                }
                return fallbackValue ?? { value: {} };
            case 'filtersFromTool':
                return filters.length > 0 ? filters : undefined;
            case 'returnAll':
                return params.limit === undefined;
            case 'maxRecords':
                return params.limit ?? 10;
            case 'bodyJson':
                if (['create', 'update'].includes(operation) && Object.keys(fieldValues).length > 0) {
                    return JSON.stringify(fieldValues);
                }
                return fallbackValue ?? '{}';
            // Label enrichment and UDF flattening -- always enable for AI tools
            case 'outputMode':
                return 'idsAndLabels';
            case 'addPicklistLabels':
                return true;
            case 'addReferenceLabels':
                return true;
            case 'flattenUdfs':
                return true;
            // Column selection
            case 'selectColumns':
                return selectedColumns.length > 0 ? selectedColumns : [];
            case 'selectColumnsJson':
                return selectedColumns.length > 0 ? JSON.stringify(selectedColumns) : '[]';
            case 'allowWriteOperations':
                return originalGetNodeParameter('allowWriteOperations', index, false);
            case 'dryRun':
                return false;
            case 'allowedResources':
                return '[]';
            case 'allowDryRunForWrites':
                return true;
            default:
                return originalGetNodeParameter(name, index, fallbackValue, options);
        }
    }) as typeof context.getNodeParameter;

    try {
        const result = await executeToolOperation.call(context);
        const items = result[0] ?? [];
        const records = items.map((item) => item.json);

        // Build structured response per operation type
        return formatToolResponse(operation, records, params);
    } catch (error) {
        // Return error as structured JSON so the LLM can interpret and recover
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        const errorResponse: Record<string, unknown> = {
            error: true,
            message,
            operation: `${resource}.${operation}`,
        };

        // Add actionable suggestions based on error content
        const lowerMsg = message.toLowerCase();
        if (code === 'ERR_INVALID_URL' || lowerMsg.includes('invalid_url') || lowerMsg.includes('invalid url')) {
            errorResponse.suggestion =
                'ERR_INVALID_URL in AI Agent context can occur with queue/scaling execution mode. Try running the workflow in main mode, or ensure the Autotask AI Tools node has valid credentials. Same credentials work in the regular Autotask node.';
        } else if (lowerMsg.includes('required') || lowerMsg.includes('missing')) {
            errorResponse.suggestion = `Check that all required fields are provided. Use describeResource to see field requirements.`;
        } else if (lowerMsg.includes('picklist') || lowerMsg.includes('invalid value')) {
            errorResponse.suggestion = `Use listPicklistValues to get valid options for the field in question.`;
        } else if (lowerMsg.includes('not found') || lowerMsg.includes('does not exist')) {
            errorResponse.suggestion = `Verify the entity ID exists. Use getMany with a filter to search for the record.`;
        } else {
            errorResponse.suggestion = `Verify field names, types, and values are correct for this resource.`;
        }

        return JSON.stringify(errorResponse);
    } finally {
        context.getNodeParameter = originalGetNodeParameter;
    }
}

/**
 * Format the raw execution result into a consistent, structured JSON response.
 */
function formatToolResponse(
    operation: string,
    records: Record<string, unknown>[],
    params: ToolExecutorParams,
): string {
    switch (operation) {
        case 'get': {
            const entity = records[0] ?? null;
            return JSON.stringify({ result: entity });
        }

        case 'getMany': {
            const total = records.length;
            const truncated = total > MAX_RESPONSE_RECORDS;
            const results = truncated ? records.slice(0, MAX_RESPONSE_RECORDS) : records;
            const response: Record<string, unknown> = {
                results,
                count: results.length,
            };
            if (truncated) {
                response.truncated = true;
                response.totalAvailable = total;
                response.note = `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Use a narrower filter or lower limit to see specific records.`;
            }
            return JSON.stringify(response);
        }

        case 'count': {
            // Count operations return items with a count property
            const countValue = records[0]?.count ?? records.length;
            return JSON.stringify({ count: countValue });
        }

        case 'create': {
            const entity = records[0] ?? null;
            return JSON.stringify({ result: entity, operation: 'create' });
        }

        case 'update': {
            const entity = records[0] ?? null;
            return JSON.stringify({ result: entity, operation: 'update' });
        }

        case 'delete': {
            const id = params.id;
            return JSON.stringify({ result: { id, deleted: true } });
        }

        default:
            return JSON.stringify(records);
    }
}
