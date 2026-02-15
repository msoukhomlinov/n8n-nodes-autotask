import type { IExecuteFunctions, IGetNodeParameterOptions } from 'n8n-workflow';
import { executeToolOperation } from '../resources/tool/execute';
import type { FieldMeta } from '../helpers/aiHelper';
import { mapFilterOp } from './schema-generator';
import { validateEntityId, validateReadFields, validateWriteFields } from './field-validator';
import { formatApiError, formatFilterConstraintError } from './error-formatter';

export interface ToolExecutorParams {
    resource: string;
    operation: string;
    id?: number;
    ticketNumber?: string;
    ticketFields?: string;
    filter_field?: string;
    filter_op?: string;
    filter_value?: string | number | boolean | Array<string | number | boolean>;
    filter_field_2?: string;
    filter_op_2?: string;
    filter_value_2?: string | number | boolean | Array<string | number | boolean>;
    limit?: number;
    fields?: string;
    recency?: string;
    since?: string;
    until?: string;
    domain?: string;
    domainOperator?: string;
    searchContactEmails?: boolean;
    [key: string]: string | number | boolean | Array<string | number | boolean> | undefined;
}

export interface ToolExecutionMetadata {
    readFields?: FieldMeta[];
    writeFields?: FieldMeta[];
}

/** Maximum records to include in a single tool response before truncation */
const MAX_RESPONSE_RECORDS = 25;
const DEFAULT_QUERY_LIMIT = 10;
const MAX_QUERY_LIMIT = 100;
const RECENCY_OVER_REQUEST_LIMIT = 500;
const RECENCY_FIELD_PRIORITY = [
    'createDateTime',
    'createDate',
    'lastModifiedDateTime',
    'lastActivityDateTime',
    'lastActivityDate',
    'dateWorked',
] as const;
const RECENCY_WINDOWS_MS: Record<string, number> = {
    last_15m: 15 * 60 * 1000,
    last_1h: 60 * 60 * 1000,
    last_4h: 4 * 60 * 60 * 1000,
    last_12h: 12 * 60 * 60 * 1000,
    last_24h: 24 * 60 * 60 * 1000,
    last_3d: 3 * 24 * 60 * 60 * 1000,
    last_7d: 7 * 24 * 60 * 60 * 1000,
    last_14d: 14 * 24 * 60 * 60 * 1000,
    last_30d: 30 * 24 * 60 * 60 * 1000,
    last_90d: 90 * 24 * 60 * 60 * 1000,
};

interface ToolFilter {
    field: string;
    op: string;
    value: string | number | boolean | Array<string | number | boolean>;
    udf?: boolean;
}

interface RecencyBuildResult {
    filters: ToolFilter[];
    isActive: boolean;
    note?: string;
}

interface ToolResponseContext {
    recencyWindowLimited?: boolean;
    recencyNote?: string;
}

function getEffectiveLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || Number.isNaN(limit)) {
        return DEFAULT_QUERY_LIMIT;
    }
    return Math.min(Math.max(Math.trunc(limit), 1), MAX_QUERY_LIMIT);
}

function buildFieldLookup(fields: FieldMeta[]): Map<string, FieldMeta> {
    return new Map(fields.map((field) => [field.id.toLowerCase(), field]));
}

function toUtcIsoSeconds(input: string, parameterName: 'since' | 'until'): string {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(
            `Invalid ${parameterName} value '${input}'. Use ISO-8601 UTC format, for example 2026-01-01T00:00:00Z.`,
        );
    }
    return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function resolveRecencyField(readFields: FieldMeta[]): string | null {
    if (readFields.length === 0) {
        return null;
    }
    const lookup = buildFieldLookup(readFields);
    for (const candidate of RECENCY_FIELD_PRIORITY) {
        const field = lookup.get(candidate.toLowerCase());
        if (field && !field.udf) {
            return field.id;
        }
    }
    const fallback = readFields.find((field) => !field.udf && field.type.toLowerCase().includes('date'));
    return fallback?.id ?? null;
}

function buildRecencyFilters(params: ToolExecutorParams, readFields: FieldMeta[]): RecencyBuildResult {
    const recency = typeof params.recency === 'string' ? params.recency.trim() : '';
    const sinceRaw = typeof params.since === 'string' ? params.since.trim() : '';
    const untilRaw = typeof params.until === 'string' ? params.until.trim() : '';
    const hasRecencyInput = Boolean(recency || sinceRaw || untilRaw);

    if (!hasRecencyInput) {
        return { filters: [], isActive: false };
    }

    const recencyField = resolveRecencyField(readFields);
    if (!recencyField) {
        return {
            filters: [],
            isActive: false,
            note: 'Recency filters were ignored because no datetime field was detected for this resource.',
        };
    }

    let startIso: string | undefined;
    if (sinceRaw) {
        startIso = toUtcIsoSeconds(sinceRaw, 'since');
    } else if (recency) {
        const windowMs = RECENCY_WINDOWS_MS[recency];
        if (!windowMs) {
            throw new Error(
                `Unsupported recency value '${recency}'. Use one of: ${Object.keys(RECENCY_WINDOWS_MS).join(', ')}.`,
            );
        }
        startIso = new Date(Date.now() - windowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    } else if (untilRaw) {
        throw new Error("The 'until' parameter requires either 'since' or 'recency'.");
    }

    if (!startIso) {
        return { filters: [], isActive: false };
    }

    const filters: ToolFilter[] = [
        {
            field: recencyField,
            op: 'gte',
            value: startIso,
        },
    ];

    if (untilRaw) {
        const endIso = toUtcIsoSeconds(untilRaw, 'until');
        if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
            throw new Error(`'until' (${endIso}) must be greater than or equal to 'since' (${startIso}).`);
        }
        filters.push({
            field: recencyField,
            op: 'lte',
            value: endIso,
        });
    }

    return { filters, isActive: true };
}

function coerceFilterValueByFieldType(
    value: string | number | boolean | Array<string | number | boolean>,
    fieldType: string | undefined,
    operator: string,
): string | number | boolean | Array<string | number | boolean> {
    const normalisedType = (fieldType ?? '').toLowerCase();
    const toTypedScalar = (input: string | number | boolean): string | number | boolean => {
        if (typeof input === 'number' || typeof input === 'boolean') {
            return input;
        }
        if (normalisedType === 'number') {
            const parsed = Number(input);
            return Number.isFinite(parsed) ? parsed : input;
        }
        if (normalisedType === 'boolean') {
            if (input.toLowerCase() === 'true') return true;
            if (input.toLowerCase() === 'false') return false;
        }
        return input;
    };

    if (operator === 'in' || operator === 'notIn') {
        if (Array.isArray(value)) {
            return value.map((v) => toTypedScalar(v));
        }
        if (typeof value === 'string' && value.includes(',')) {
            return value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
                .map((v) => toTypedScalar(v));
        }
        return [toTypedScalar(value)];
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? toTypedScalar(value[0]) : '';
    }
    return toTypedScalar(value);
}

/**
 * Build Autotask filter array from flat getMany/count params.
 * Supports two filter triplets for compound queries.
 */
function buildFilterFromParams(
    params: ToolExecutorParams,
    readFields: FieldMeta[],
): ToolFilter[] {
    const filters: ToolFilter[] = [];
    const readFieldLookup = buildFieldLookup(readFields);

    // First filter
    if (params.filter_field && params.filter_value !== undefined && params.filter_value !== '') {
        const canonicalField = readFieldLookup.get(params.filter_field.toLowerCase());
        const mappedOp = mapFilterOp(params.filter_op || 'eq');
        filters.push({
            field: canonicalField?.id ?? params.filter_field,
            op: mappedOp,
            value: coerceFilterValueByFieldType(params.filter_value, canonicalField?.type, mappedOp),
            ...(canonicalField?.udf ? { udf: true } : {}),
        });
    }

    // Second filter
    if (params.filter_field_2 && params.filter_value_2 !== undefined && params.filter_value_2 !== '') {
        const canonicalField = readFieldLookup.get(params.filter_field_2.toLowerCase());
        const mappedOp = mapFilterOp(params.filter_op_2 || 'eq');
        filters.push({
            field: canonicalField?.id ?? params.filter_field_2,
            op: mappedOp,
            value: coerceFilterValueByFieldType(params.filter_value_2, canonicalField?.type, mappedOp),
            ...(canonicalField?.udf ? { udf: true } : {}),
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
    writeFields: FieldMeta[],
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const writeFieldLookup = buildFieldLookup(writeFields);
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
        'recency',
        'since',
        'until',
        'domain',
        'domainOperator',
        'searchContactEmails',
    ]);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '' && !exclude.has(key)) {
            const canonicalField = writeFieldLookup.get(key.toLowerCase());
            result[canonicalField?.id ?? key] = value;
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
 * Normalise operation names to canonical forms used by the executor.
 */
function normaliseOperation(operation: string): string {
    const key = operation.trim().toLowerCase();
    switch (key) {
        case 'getmany':
            return 'getMany';
        case 'whoami':
            return 'whoAmI';
        case 'getposted':
            return 'getPosted';
        case 'getunposted':
            return 'getUnposted';
        case 'searchbydomain':
            return 'searchByDomain';
        case 'slahealthcheck':
            return 'slaHealthCheck';
        case 'moveconfigurationitem':
            return 'moveConfigurationItem';
        case 'movetocompany':
            return 'moveToCompany';
        case 'transferownership':
            return 'transferOwnership';
        default:
            return key;
    }
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
    metadata: ToolExecutionMetadata = {},
): Promise<string> {
    const originalGetNodeParameter = context.getNodeParameter.bind(context);
    const readFields = metadata.readFields ?? [];
    const writeFields = metadata.writeFields ?? [];
    const fieldValues = buildFieldValues(params, ['id'], writeFields);
    const filters = buildFilterFromParams(params, readFields);
    const entityId = params.id !== undefined ? String(params.id) : '';
    const selectedColumns = parseFieldsParam(params.fields);
    const selectedSlaTicketColumns = parseFieldsParam(params.ticketFields);
    const effectiveLimit = getEffectiveLimit(params.limit);
    const normalisedOperation = normaliseOperation(operation);

    // Build recency filters BEFORE determining effectiveOperation so that
    // recency-only queries (no explicit filter_field) correctly upgrade
    // a bare 'get' to 'getMany'.
    let recencyResult: RecencyBuildResult;
    try {
        recencyResult = buildRecencyFilters(params, readFields);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return JSON.stringify(
            formatFilterConstraintError(
                resource,
                normalisedOperation,
                detail,
                "Use recency windows (for example 'last_7d') or ISO-8601 UTC values for since/until.",
            ),
        );
    }
    if (recencyResult.filters.length > 0) {
        filters.push(...recencyResult.filters);
    }

    const effectiveOperation =
        normalisedOperation === 'get' && entityId === '' && filters.length > 0
            ? 'getMany'
            : normalisedOperation;
    const queryLimit = recencyResult.isActive ? RECENCY_OVER_REQUEST_LIMIT : effectiveLimit;

    const idValidation = validateEntityId(entityId, resource, effectiveOperation);
    if (!idValidation.valid) {
        return JSON.stringify(idValidation.error);
    }

    if (['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI'].includes(effectiveOperation)) {
        const udfFilters = filters.filter((filter) => filter.udf);
        if (udfFilters.length > 1) {
            return JSON.stringify(
                formatFilterConstraintError(
                    resource,
                    effectiveOperation,
                    `Only one UDF filter is supported per query for ${resource}.${effectiveOperation}.`,
                    `Retry with a single UDF filter, or call autotask_${resource}_describeFields to use standard fields where possible.`,
                ),
            );
        }
        const readValidation = validateReadFields(selectedColumns, readFields, resource, effectiveOperation);
        if (!readValidation.valid) {
            return JSON.stringify(readValidation.error);
        }
    }

    if (['create', 'update'].includes(effectiveOperation)) {
        const writeValidation = validateWriteFields(fieldValues, writeFields, resource, effectiveOperation);
        if (!writeValidation.valid) {
            return JSON.stringify(writeValidation.error);
        }
    }

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
                return effectiveOperation;
            case 'id':
                return entityId;
            case 'targetOperation':
                return `${resource}.${effectiveOperation}`;
            case 'entityId':
                return entityId;
            case 'requestData': {
                const data: Record<string, unknown> =
                    ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && filters.length > 0
                        ? { filter: filters }
                        : Object.keys(fieldValues).length > 0
                            ? fieldValues
                            : {};
                if (effectiveOperation === 'slaHealthCheck') {
                    if (params.id !== undefined) {
                        data.id = params.id;
                    }
                    if (typeof params.ticketNumber === 'string' && params.ticketNumber.trim() !== '') {
                        data.ticketNumber = params.ticketNumber.trim();
                    }
                    if (selectedSlaTicketColumns.length > 0) {
                        data.slaTicketFields = selectedSlaTicketColumns;
                    }
                }
                // Always apply bounded query limits for list/count style operations.
                if (['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation)) {
                    data.limit = queryLimit;
                }
                if (effectiveOperation === 'searchByDomain') {
                    data.limit = effectiveLimit;
                }
                return JSON.stringify(data);
            }
            case 'fieldsToMap':
                if (['create', 'update'].includes(effectiveOperation) && Object.keys(fieldValues).length > 0) {
                    return { mappingMode: 'defineBelow', value: fieldValues };
                }
                if (['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && filters.length > 0) {
                    const value: Record<string, unknown> = {};
                    for (const f of filters) {
                        value[f.field] = f.value;
                    }
                    return { value };
                }
                return fallbackValue ?? { value: {} };
            case 'filtersFromTool':
                return ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && filters.length > 0
                    ? filters
                    : undefined;
            case 'returnAll':
                return false;
            case 'maxRecords':
                return queryLimit;
            case 'bodyJson':
                if (['create', 'update'].includes(effectiveOperation) && Object.keys(fieldValues).length > 0) {
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
            case 'ticketIdentifierType':
                if (effectiveOperation === 'slaHealthCheck') {
                    if (typeof params.ticketNumber === 'string' && params.ticketNumber.trim() !== '') {
                        return 'ticketNumber';
                    }
                    return 'id';
                }
                return fallbackValue;
            case 'ticketNumber':
                if (effectiveOperation === 'slaHealthCheck') {
                    return typeof params.ticketNumber === 'string' ? params.ticketNumber.trim() : fallbackValue;
                }
                return fallbackValue;
            case 'slaTicketFields':
                if (effectiveOperation === 'slaHealthCheck') {
                    return selectedSlaTicketColumns.length > 0 ? selectedSlaTicketColumns : [];
                }
                return fallbackValue;
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
                if (Object.prototype.hasOwnProperty.call(params, name)) {
                    return params[name as keyof ToolExecutorParams];
                }
                return originalGetNodeParameter(name, index, fallbackValue, options);
        }
    }) as typeof context.getNodeParameter;

    try {
        const result = await executeToolOperation.call(context);
        const items = result[0] ?? [];
        const fetchedRecords = items.map((item) => item.json);
        let records = fetchedRecords;
        const supportsListResponse = ['getMany', 'getPosted', 'getUnposted'].includes(effectiveOperation);
        if (recencyResult.isActive && supportsListResponse) {
            records = fetchedRecords.slice().reverse().slice(0, effectiveLimit);
        }
        const responseContext: ToolResponseContext = {
            recencyNote: recencyResult.note,
            recencyWindowLimited:
                recencyResult.isActive &&
                supportsListResponse &&
                fetchedRecords.length >= RECENCY_OVER_REQUEST_LIMIT,
        };

        // Build structured response per operation type
        return formatToolResponse(effectiveOperation, records, params, responseContext);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify(formatApiError(message, resource, effectiveOperation));
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
    context: ToolResponseContext = {},
): string {
    const firstRecord = records[0] ?? null;
    const extractOperationId = (record: Record<string, unknown> | null): number | string | null => {
        if (!record) return null;
        const idCandidate = record.itemId ?? record.id;
        if (typeof idCandidate === 'number' || typeof idCandidate === 'string') {
            return idCandidate;
        }
        return null;
    };

    switch (operation) {
        case 'get': {
            const entity = firstRecord;
            return JSON.stringify({ result: entity });
        }

        case 'getMany':
        case 'getPosted':
        case 'getUnposted': {
            const total = records.length;
            const truncated = total > MAX_RESPONSE_RECORDS;
            const results = truncated ? records.slice(0, MAX_RESPONSE_RECORDS) : records;
            const response: Record<string, unknown> = {
                results,
                count: results.length,
            };
            const notes: string[] = [];
            if (truncated) {
                response.truncated = true;
                response.totalAvailable = total;
                notes.push(
                    `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Use a narrower filter or lower limit to see specific records.`,
                );
            }
            if (context.recencyWindowLimited) {
                notes.push(
                    '500 records were returned for the current recency window. Narrow recency, or provide since/until, to ensure the newest records are included.',
                );
            }
            if (context.recencyNote) {
                notes.push(context.recencyNote);
            }
            if (notes.length === 1) {
                response.note = notes[0];
            } else if (notes.length > 1) {
                response.notes = notes;
                response.note = notes.join(' ');
            }
            return JSON.stringify(response);
        }

        case 'whoAmI': {
            const result = firstRecord;
            return JSON.stringify({ result });
        }

        case 'searchByDomain': {
            const result = firstRecord ?? null;
            return JSON.stringify({ result });
        }

        case 'slaHealthCheck': {
            const result = firstRecord ?? null;
            return JSON.stringify({ result });
        }

        case 'moveConfigurationItem': {
            const result = firstRecord ?? null;
            return JSON.stringify({ result });
        }

        case 'moveToCompany': {
            const result = firstRecord ?? null;
            return JSON.stringify({ result });
        }

        case 'transferOwnership': {
            const result = firstRecord ?? null;
            return JSON.stringify({ result });
        }

        case 'count': {
            // Count operations return items with a count property
            const countValue = records[0]?.count ?? records.length;
            return JSON.stringify({ count: countValue });
        }

        case 'create': {
            const operationId = extractOperationId(firstRecord);
            return JSON.stringify({
                success: true,
                operation: 'create',
                itemId: operationId,
                result: firstRecord,
            });
        }

        case 'update': {
            const operationId = extractOperationId(firstRecord);
            return JSON.stringify({
                success: true,
                operation: 'update',
                itemId: operationId,
                result: firstRecord,
            });
        }

        case 'delete': {
            const id = params.id;
            return JSON.stringify({
                success: true,
                operation: 'delete',
                result: {
                    id,
                    deleted: true,
                },
            });
        }

        default:
            return JSON.stringify(records);
    }
}
