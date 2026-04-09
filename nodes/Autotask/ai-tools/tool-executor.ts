import type { IExecuteFunctions, IGetNodeParameterOptions, ILoadOptionsFunctions, IDataObject } from 'n8n-workflow';
import { executeToolOperation } from '../resources/tool/execute';
import type { FieldMeta } from '../helpers/aiHelper';
import { describeResource, listPicklistValues, type DescribeResourceResponse } from '../helpers/aiHelper';
import { mapFilterOp } from './schema-generator';
import { validateEntityId, validateReadFields, validateWriteFields } from './field-validator';
import { formatApiError, formatFilterConstraintError, formatNotFoundError, formatNoResultsFound, wrapSuccess, wrapError, ERROR_TYPES } from './error-formatter';
import { resolveLabelsToIds, resolveFilterLabelsToIds, type LabelResolution, type PendingLabelConfirmation } from '../helpers/label-resolution';
import { applyChangeInfoAliases, buildAliasMap, shouldApplyAliases } from '../helpers/change-info-aliases';
import { getIdentifierPairConfig } from '../constants/resource-operations';
import type { IAutotaskCredentials } from '../types/base/auth';

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
    filter_logic?: 'and' | 'or';
    limit?: number;
    offset?: number;
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

const RECENCY_CUSTOM_DAYS_MIN = 1;
const RECENCY_CUSTOM_DAYS_MAX = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseRecencyWindowMs(recency: string): number {
    const preset = RECENCY_WINDOWS_MS[recency];
    if (preset !== undefined) {
        return preset;
    }
    const match = /^last_(\d+)d$/.exec(recency);
    if (match) {
        const days = parseInt(match[1], 10);
        if (Number.isFinite(days) && days >= RECENCY_CUSTOM_DAYS_MIN && days <= RECENCY_CUSTOM_DAYS_MAX) {
            return days * MS_PER_DAY;
        }
    }
    const presets = Object.keys(RECENCY_WINDOWS_MS).join(', ');
    throw new Error(
        `Unsupported recency value '${recency}'. Use a preset (${presets}) or custom last_Nd with N between ${RECENCY_CUSTOM_DAYS_MIN} and ${RECENCY_CUSTOM_DAYS_MAX} (e.g. last_5d, last_45d).`,
    );
}

interface ToolFilter {
    field: string;
    op: string;
    value?: string | number | boolean | Array<string | number | boolean>;
    udf?: boolean;
}

interface RecencyBuildResult {
    filters: ToolFilter[];
    isActive: boolean;
    note?: string;
}

interface ToolResponseContext {
    recencyActive?: boolean;
    recencyWindowLimited?: boolean;
    recencyNote?: string;
    resolutions?: LabelResolution[];
    resolutionWarnings?: string[];
    pendingConfirmations?: PendingLabelConfirmation[];
    effectiveOffset?: number;
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
        const windowMs = parseRecencyWindowMs(recency);
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
    const mappedOp1 = params.filter_op ? mapFilterOp(params.filter_op) : 'eq';
    const isNullCheckOp1 = mappedOp1 === 'exist' || mappedOp1 === 'notExist';
    if (params.filter_field && (isNullCheckOp1 || (params.filter_value !== undefined && params.filter_value !== ''))) {
        const canonicalField = readFieldLookup.get(params.filter_field.toLowerCase());
        filters.push({
            field: canonicalField?.id ?? params.filter_field,
            op: mappedOp1,
            ...(!isNullCheckOp1 ? { value: coerceFilterValueByFieldType(params.filter_value as string | number | boolean | Array<string | number | boolean>, canonicalField?.type, mappedOp1) } : {}),
            ...(canonicalField?.udf ? { udf: true } : {}),
        });
    }

    // Second filter
    const mappedOp2 = params.filter_op_2 ? mapFilterOp(params.filter_op_2) : 'eq';
    const isNullCheckOp2 = mappedOp2 === 'exist' || mappedOp2 === 'notExist';
    if (params.filter_field_2 && (isNullCheckOp2 || (params.filter_value_2 !== undefined && params.filter_value_2 !== ''))) {
        const canonicalField = readFieldLookup.get(params.filter_field_2.toLowerCase());
        filters.push({
            field: canonicalField?.id ?? params.filter_field_2,
            op: mappedOp2,
            ...(!isNullCheckOp2 ? { value: coerceFilterValueByFieldType(params.filter_value_2 as string | number | boolean | Array<string | number | boolean>, canonicalField?.type, mappedOp2) } : {}),
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
        'filter_logic',
        'limit',
        'offset',
        'fields',
        'recency',
        'since',
        'until',
        'domain',
        'domainOperator',
        'searchContactEmails',
				'impersonationResourceId',
				'proceedWithoutImpersonationIfDenied',
				'dedupFields',
				'errorOnDuplicate',
				'updateFields',
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
        case 'createifnotexists':
            return 'createIfNotExists';
        case 'getbyresource':
            return 'getByResource';
        case 'getbyyear':
            return 'getByYear';
        default:
            return key;
    }
}

/** n8n framework fields injected into every tool call — must not reach API request bodies */
const N8N_METADATA_FIELDS = new Set([
    'sessionId', 'action', 'chatInput',
    'root',
    'tool', 'toolName', 'toolCallId',
    'operation',
]);

/** Key prefixes injected by n8n that must be stripped regardless of suffix */
const N8N_METADATA_PREFIXES = ['Prompt__'];

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

/**
 * Execute an Autotask operation by routing to the existing tool executor
 * with getNodeParameter overridden to map flat AI tool params.
 */
export async function executeAiTool(
    context: IExecuteFunctions,
    resource: string,
    operation: string,
    rawParams: ToolExecutorParams,
    metadata: ToolExecutionMetadata = {},
): Promise<string> {
    // Strip n8n framework metadata injected into every tool call
    const params = {} as ToolExecutorParams;
    for (const [key, value] of Object.entries(rawParams)) {
        if (N8N_METADATA_FIELDS.has(key)) continue;
        if (N8N_METADATA_PREFIXES.some((p) => key.startsWith(p))) continue;
        (params as Record<string, unknown>)[key] = value;
    }

    const originalGetNodeParameter = context.getNodeParameter.bind(context);
    const readFields = metadata.readFields ?? [];
    const writeFields = metadata.writeFields ?? [];
    const fieldValues = buildFieldValues(params, ['id'], writeFields);
    const filters = buildFilterFromParams(params, readFields);
    const entityId = params.id !== undefined ? String(params.id) : '';

    // Resolve human-readable labels to IDs for filter values on reference/picklist fields.
    // This allows the LLM to pass e.g. filter_field="companyID", filter_value="Contoso"
    // instead of requiring a prerequisite lookup to get the numeric ID.
    const filterResolutions: LabelResolution[] = [];
    const filterWarnings: string[] = [];
    const filterPendingConfirmations: PendingLabelConfirmation[] = [];
    for (const filter of filters) {
        if (filter.value !== undefined && typeof filter.value === 'string') {
            try {
                const resolution = await resolveFilterLabelsToIds(
                    context, resource, filter.field, filter.value, readFields,
                );
                if (resolution.resolutions.length > 0) {
                    filter.value = resolution.values[filter.field] as string | number | boolean;
                    filterResolutions.push(...resolution.resolutions);
                }
                if (resolution.warnings.length > 0) {
                    filterWarnings.push(...resolution.warnings);
                }
                if (resolution.pendingConfirmations.length > 0) {
                    filterPendingConfirmations.push(...resolution.pendingConfirmations);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                filterWarnings.push(`Filter label resolution failed for '${filter.field}': ${msg}`);
            }
        } else if (Array.isArray(filter.value) && filter.value.some(v => typeof v === 'string' && !/^\d+$/.test(v))) {
            // Warn when in/notIn arrays contain non-numeric strings on reference/picklist fields
            const fieldMeta = readFields.find(f => f.id.toLowerCase() === filter.field.toLowerCase());
            if (fieldMeta && (fieldMeta.isPickList || fieldMeta.isReference)) {
                filterWarnings.push(
                    `Filter field '${filter.field}' uses in/notIn with string values. Name-based resolution is not supported for array filter values — use numeric IDs instead.`,
                );
            }
        }
    }
    const selectedColumns = parseFieldsParam(params.fields);
    const selectedSlaTicketColumns = parseFieldsParam(params.ticketFields);
    const effectiveLimit = getEffectiveLimit(params.limit);
    const effectiveOffset = typeof params.offset === 'number' && Number.isFinite(params.offset) && params.offset >= 0
        ? Math.trunc(params.offset) : 0;
    const normalisedOperation = normaliseOperation(operation);

    // Handle helper operations that bypass the standard executor
    if (normalisedOperation === 'describeFields') {
        try {
            const mode = (params.mode as 'read' | 'write') ?? 'read';
            const result = await describeResource(context as unknown as ILoadOptionsFunctions, resource, mode);
            return JSON.stringify(wrapSuccess(resource, 'describeFields', compactDescribeResponse(result)));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return JSON.stringify(formatApiError(message, resource, 'describeFields'));
        }
    }
    if (normalisedOperation === 'listPicklistValues') {
        try {
            const result = await listPicklistValues(
                context as unknown as ILoadOptionsFunctions,
                resource,
                params.fieldId as string,
                params.query as string | undefined,
                (params.limit as number) ?? 50,
                (params.page as number) ?? 1,
            );
            return JSON.stringify(wrapSuccess(resource, 'listPicklistValues', result));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return JSON.stringify(formatApiError(message, resource, 'listPicklistValues'));
        }
    }

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
    // Build combined filter structure with proper AND/OR grouping.
    // User filters may be OR-grouped; recency filters are ALWAYS ANDed on top (they constrain the time window).
    const filterLogic = params.filter_logic === 'or' ? 'or' : 'and';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let combinedFilters: any[];
    if (filterLogic === 'or' && filters.length >= 2 && recencyResult.filters.length > 0) {
        // OR between user filters, AND with recency: [{op:'or', items:[f1,f2]}, recency...]
        // finalizeResourceMapperFilters will wrap the top-level array with AND
        combinedFilters = [{ op: 'or', items: [...filters] }, ...recencyResult.filters];
    } else if (filterLogic === 'or' && filters.length >= 2) {
        // OR between user filters, no recency
        combinedFilters = [{ op: 'or', items: [...filters] }];
    } else {
        // AND (default) or single filter — flat array
        combinedFilters = [...filters, ...recencyResult.filters];
    }

    const allFilterCount = filters.length + recencyResult.filters.length;
    const effectiveOperation =
        normalisedOperation === 'get' && entityId === '' && allFilterCount > 0
            ? 'getMany'
            : normalisedOperation;
    // When offset is used, we need offset+limit records from the API then slice client-side.
    // Cap at MAX_QUERY_LIMIT to stay within API bounds; warn if offset exceeds this.
    const offsetExceedsApiCap = effectiveOffset > 0 && effectiveOffset >= MAX_QUERY_LIMIT;
    const supportsOffsetPagination = ['getMany', 'getPosted', 'getUnposted'].includes(effectiveOperation);
    const queryLimit = recencyResult.isActive
        ? RECENCY_OVER_REQUEST_LIMIT
        : (effectiveOffset > 0 && supportsOffsetPagination)
            ? Math.min(effectiveOffset + effectiveLimit, MAX_QUERY_LIMIT)
            : effectiveLimit;

    if (supportsOffsetPagination && offsetExceedsApiCap) {
        return JSON.stringify(wrapError(
            resource, effectiveOperation, ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
            `Offset ${effectiveOffset} exceeds the maximum queryable range of ${MAX_QUERY_LIMIT} records. Pagination via offset is limited to the first ${MAX_QUERY_LIMIT} records.`,
            `Use narrower filters (e.g. date ranges via since/until, or more specific filter_field/filter_value) to reduce the result set, then paginate within the narrowed results.`,
        ));
    }

    const idValidation = validateEntityId(entityId, resource, effectiveOperation);
    if (!idValidation.valid) {
        return JSON.stringify(idValidation.error);
    }

    // Pre-flight: operations using the identifier-pair pattern (id OR altIdField) require at least one.
    // This returns a structured error before the runtime handler throws an unhandled exception.
    const idPairConfig = getIdentifierPairConfig(resource, effectiveOperation);
    if (idPairConfig) {
        const hasId = typeof params.id === 'number' && params.id > 0;
        const hasAltId = typeof params[idPairConfig.altIdField as keyof typeof params] === 'string'
            && (params[idPairConfig.altIdField as keyof typeof params] as string).trim() !== '';
        if (!hasId && !hasAltId) {
            return JSON.stringify(wrapError(
                resource,
                operation,
                ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
                `${effectiveOperation} requires a ticket identifier: provide 'id' (numeric Ticket ID) or '${idPairConfig.altIdField}' (format ${idPairConfig.altIdFormat}, e.g. ${idPairConfig.altIdExample}).`,
                `Call autotask_${resource} with operation '${effectiveOperation}' and include either 'id' (numeric Ticket ID) or '${idPairConfig.altIdField}' (format ${idPairConfig.altIdFormat}, e.g. ${idPairConfig.altIdExample}).`,
            ));
        }
    }

    if (['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain'].includes(effectiveOperation)) {
        const udfFilters = filters.filter((filter) => filter.udf);
        if (udfFilters.length > 1) {
            return JSON.stringify(
                formatFilterConstraintError(
                    resource,
                    effectiveOperation,
                    `Only one UDF filter is supported per query for ${resource}.${effectiveOperation}.`,
                    `Retry with a single UDF filter, or use autotask_${resource} with operation 'describeFields' to use standard fields where possible.`,
                ),
            );
        }
        const readValidation = validateReadFields(selectedColumns, readFields, resource, effectiveOperation);
        if (!readValidation.valid) {
            return JSON.stringify(readValidation.error);
        }
    }

    if (['create', 'update', 'createIfNotExists'].includes(effectiveOperation)) {
        const writeValidation = validateWriteFields(fieldValues, writeFields, resource, effectiveOperation);
        if (!writeValidation.valid) {
            return JSON.stringify(writeValidation.error);
        }
    }

    // Resolve human-readable labels to IDs for picklist and reference fields on write ops.
    // This allows the LLM to pass names (e.g. "Will Spence") instead of numeric IDs.
    let labelResolutions: LabelResolution[] = [];
    let labelWarnings: string[] = [];
    let labelPendingConfirmations: PendingLabelConfirmation[] = [];
    if (['create', 'update', 'createIfNotExists'].includes(effectiveOperation) && Object.keys(fieldValues).length > 0) {
        try {
            const resolution = await resolveLabelsToIds(context, resource, fieldValues as IDataObject);
            // Replace fieldValues entries with resolved IDs in-place
            for (const [key, value] of Object.entries(resolution.values)) {
                fieldValues[key] = value;
            }
            labelResolutions = resolution.resolutions;
            labelWarnings = resolution.warnings;
            labelPendingConfirmations = resolution.pendingConfirmations;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            labelWarnings.push(`Label resolution failed: ${msg}. Proceeding with raw values.`);
        }
    }

    // Resolve impersonationResourceId name/email → numeric ID for write operations only.
    // Gated to write ops to avoid unnecessary Resource entity list fetch on reads.
    const isWriteOperation = ['create', 'createIfNotExists', 'update', 'moveConfigurationItem', 'moveToCompany', 'transferOwnership', 'approve', 'reject', 'delete'].includes(effectiveOperation);
    let resolvedImpersonationId: number | undefined;
    const rawImpersonation = params.impersonationResourceId;
    if (isWriteOperation && rawImpersonation !== undefined && rawImpersonation !== null && rawImpersonation !== '') {
        const impersonationValue = typeof rawImpersonation === 'string' ? rawImpersonation.trim() : rawImpersonation;
        const isNumericId = typeof impersonationValue === 'number' ||
            (typeof impersonationValue === 'string' && /^\d+$/.test(impersonationValue) && String(parseInt(impersonationValue, 10)) === impersonationValue);

        if (isNumericId) {
            resolvedImpersonationId = typeof impersonationValue === 'number' ? impersonationValue : parseInt(impersonationValue, 10);
        } else if (typeof impersonationValue === 'string') {
            // Resolve name or email to resource ID
            try {
                const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
                const helper = new EntityValueHelper(context as unknown as import('n8n-workflow').ILoadOptionsFunctions, 'Resource');
                const candidates = await helper.getValues(true);
                const label = impersonationValue.toLowerCase();

                // Try exact name match first
                let matchedId: number | undefined;
                for (const entity of candidates) {
                    const entityObj = entity as unknown as IDataObject;
                    const display = helper.getEntityDisplayName(entityObj);
                    if (display && display.toLowerCase() === label) {
                        matchedId = entityObj.id as number;
                        break;
                    }
                    // Also check email fields (must check each independently — ?? stops at first non-null)
                    const emailFields = [entityObj.email, entityObj.email2, entityObj.email3] as (string | undefined)[];
                    if (emailFields.some(e => e && e.toLowerCase() === label)) {
                        matchedId = entityObj.id as number;
                        break;
                    }
                }

                if (matchedId !== undefined) {
                    resolvedImpersonationId = matchedId;
                    labelResolutions.push({ field: 'impersonationResourceId', from: impersonationValue, to: matchedId, method: 'reference' });
                } else {
                    // Partial match → warning, pass raw value
                    labelWarnings.push(`Could not resolve impersonation resource '${impersonationValue}' to a resource ID. Provide a numeric ID instead.`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                labelWarnings.push(`Impersonation resource resolution failed: ${msg}. Provide a numeric ID instead.`);
            }
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
                    ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && combinedFilters.length > 0
                        ? { filter: combinedFilters }
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
                // Note: offset is applied client-side only (slice after fetch), not sent to API.
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
                if (['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && combinedFilters.length > 0) {
                    const value: Record<string, unknown> = {};
                    // Only extract field/value from flat filter objects (skip nested OR/AND groups)
                    for (const f of combinedFilters) {
                        if (f.field !== undefined) {
                            value[f.field] = f.value;
                        }
                    }
                    return { value };
                }
                return fallbackValue ?? { value: {} };
            case 'filtersFromTool':
                return ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) && combinedFilters.length > 0
                    ? combinedFilters
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
            case 'ticketIdentifierType': {
                const ipc = getIdentifierPairConfig(resource, effectiveOperation);
                if (ipc) {
                    const altVal = params[ipc.altIdField as keyof typeof params];
                    return (typeof altVal === 'string' && altVal.trim() !== '') ? ipc.altIdField : 'id';
                }
                return fallbackValue;
            }
            case 'ticketNumber': {
                const ipc = getIdentifierPairConfig(resource, effectiveOperation);
                if (ipc && ipc.altIdField === 'ticketNumber') {
                    return typeof params.ticketNumber === 'string' ? params.ticketNumber.trim() : fallbackValue;
                }
                return fallbackValue;
            }
            case 'includeRaw':
                if (effectiveOperation === 'summary') {
                    return typeof params.includeRaw === 'boolean' ? params.includeRaw : false;
                }
                return fallbackValue;
            case 'summaryTextLimit':
                if (effectiveOperation === 'summary') {
                    return typeof params.summaryTextLimit === 'number' ? params.summaryTextLimit : 500;
                }
                return fallbackValue;
            case 'includeChildCounts':
                if (effectiveOperation === 'summary') {
                    return typeof params.includeChildCounts === 'boolean' ? params.includeChildCounts : false;
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
            case 'impersonationResourceId':
                if (resolvedImpersonationId !== undefined) {
                    return resolvedImpersonationId;
                }
                // If rawImpersonation was a non-numeric string that failed resolution,
                // return fallbackValue so getOptionalImpersonationResourceId treats it as absent.
                // The warning is already in labelWarnings.
                if (typeof rawImpersonation === 'string' && rawImpersonation.trim() !== '' && !/^\d+$/.test(rawImpersonation.trim())) {
                    return fallbackValue;
                }
                return rawImpersonation ?? fallbackValue;
            case 'dryRun':
                return params.dryRun === true;
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
        // Compound operation short-circuit: createIfNotExists bypasses the standard executor
        if (effectiveOperation === 'createIfNotExists') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let compoundResult: any;

            // createFields comes from fieldValues (already validated + label-resolved above)
            const createFields: Record<string, unknown> = { ...fieldValues };
            const DEFAULT_DEDUP_FIELDS: Record<string, string[]> = {
                contractCharge: ['name', 'datePurchased'],
                ticketCharge: ['name', 'datePurchased'],
                projectCharge: ['name', 'datePurchased'],
                configurationItems: ['serialNumber'],
                timeEntry: ['dateWorked', 'hoursWorked'],
                contractService: ['serviceID'],
                contract: ['contractName'],
                expenseItem: ['expenseDate', 'description'],
                holiday: ['holidayDate'],
                holidaySet: ['holidaySetName'],
                opportunity: ['title'],
                ticketAdditionalConfigurationItem: ['configurationItemID'],
                ticketAdditionalContact: ['contactID'],
                changeRequestLink: ['changeRequestTicketID', 'problemOrIncidentTicketID'],
            };
            const dedupFields = (params.dedupFields as string[]) ?? DEFAULT_DEDUP_FIELDS[resource] ?? [];
            const errorOnDuplicate = params.errorOnDuplicate === true;
            const updateFields = (params.updateFields as string[] | undefined) ?? [];

            const compoundOptions = {
                createFields,
                dedupFields,
                errorOnDuplicate,
                updateFields,
                impersonationResourceId: resolvedImpersonationId,
                proceedWithoutImpersonationIfDenied: params.proceedWithoutImpersonationIfDenied !== false,
            };

            if (resource === 'contractCharge') {
                const { createContractChargeIfNotExists } = await import('../helpers/contract-charge-creator');
                compoundResult = await createContractChargeIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'ticketCharge') {
                const { createTicketChargeIfNotExists } = await import('../helpers/ticket-charge-creator');
                compoundResult = await createTicketChargeIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'projectCharge') {
                const { createProjectChargeIfNotExists } = await import('../helpers/project-charge-creator');
                compoundResult = await createProjectChargeIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'configurationItems') {
                const { createConfigurationItemIfNotExists } = await import('../helpers/configuration-item-creator');
                compoundResult = await createConfigurationItemIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'timeEntry') {
                const { createTimeEntryIfNotExists } = await import('../helpers/time-entry-creator');
                compoundResult = await createTimeEntryIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'contractService') {
                const { createContractServiceIfNotExists } = await import('../helpers/contract-service-creator');
                compoundResult = await createContractServiceIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'contract') {
                const { createContractIfNotExists } = await import('../helpers/contract-creator');
                compoundResult = await createContractIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'opportunity') {
                const { createOpportunityIfNotExists } = await import('../helpers/opportunity-creator');
                compoundResult = await createOpportunityIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'expenseItem') {
                const { createExpenseItemIfNotExists } = await import('../helpers/expense-item-creator');
                compoundResult = await createExpenseItemIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'ticketAdditionalConfigurationItem') {
                const { createTicketAdditionalCIIfNotExists } = await import('../helpers/ticket-additional-ci-creator');
                compoundResult = await createTicketAdditionalCIIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'ticketAdditionalContact') {
                const { createTicketAdditionalContactIfNotExists } = await import('../helpers/ticket-additional-contact-creator');
                compoundResult = await createTicketAdditionalContactIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'changeRequestLink') {
                const { createChangeRequestLinkIfNotExists } = await import('../helpers/change-request-link-creator');
                compoundResult = await createChangeRequestLinkIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'holidaySet') {
                const { createHolidaySetIfNotExists } = await import('../helpers/holiday-set-creator');
                compoundResult = await createHolidaySetIfNotExists(context, 0, compoundOptions);
            } else if (resource === 'holiday') {
                const { createHolidayIfNotExists } = await import('../helpers/holiday-creator');
                compoundResult = await createHolidayIfNotExists(context, 0, compoundOptions);
            } else {
                return JSON.stringify(wrapError(resource, `${resource}.createIfNotExists`, ERROR_TYPES.INVALID_OPERATION,
                    `createIfNotExists is not implemented for resource '${resource}'.`,
                    `Use autotask_${resource} with operation 'create' instead.`,
                ));
            }

            if (compoundResult) {
                if (labelResolutions.length > 0) {
                    (compoundResult as Record<string, unknown>).resolvedLabels = labelResolutions;
                }
                if (labelWarnings.length > 0) {
                    const warnings = (compoundResult as Record<string, unknown>).warnings;
                    if (Array.isArray(warnings)) {
                        warnings.push(...labelWarnings);
                    }
                }
                if (labelPendingConfirmations.length > 0) {
                    (compoundResult as Record<string, unknown>).pendingConfirmations = labelPendingConfirmations;
                }
                return JSON.stringify(wrapSuccess(resource, `${resource}.createIfNotExists`, compoundResult));
            }
        }

        const result = await executeToolOperation.call(context);
        const items = result[0] ?? [];
        const fetchedRecords = items.map((item) => item.json);
        let records = fetchedRecords;
        const supportsListResponse = ['getMany', 'getPosted', 'getUnposted'].includes(effectiveOperation);
        // Recency takes priority: reverse-sort by date and take first N. Offset is not
        // compatible with recency (recency re-sorts the full window), so ignore offset here.
        if (recencyResult.isActive && supportsListResponse) {
            records = fetchedRecords.slice().reverse().slice(0, effectiveLimit);
        } else if (effectiveOffset > 0 && supportsListResponse) {
            records = fetchedRecords.slice(effectiveOffset, effectiveOffset + effectiveLimit);
            // Detect offset beyond available records — return clear error instead of
            // misleading "no results found" which could trigger LLM data fabrication.
            if (records.length === 0 && fetchedRecords.length > 0) {
                return JSON.stringify(wrapError(
                    resource, effectiveOperation, ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
                    `Offset ${effectiveOffset} is beyond the available ${fetchedRecords.length} records. No records remain at this offset.`,
                    `Use offset=0 to start from the beginning, or use narrower filters to find specific records.`,
                ));
            }
        }
        // Merge write label resolutions and filter label resolutions
        const allResolutions = [...labelResolutions, ...filterResolutions];
        const allWarnings = [...labelWarnings, ...filterWarnings];
        const allPendingConfirmations = [...labelPendingConfirmations, ...filterPendingConfirmations];
        // When recency is active, offset-based pagination is not supported — add a note
        const recencyOffsetNote = recencyResult.isActive && effectiveOffset > 0
            ? 'Offset is ignored when recency or since/until is active (recency re-sorts results by date).'
            : undefined;
        const responseContext: ToolResponseContext = {
            recencyActive: recencyResult.isActive,
            recencyNote: recencyResult.note ?? recencyOffsetNote,
            recencyWindowLimited:
                recencyResult.isActive &&
                supportsListResponse &&
                fetchedRecords.length >= RECENCY_OVER_REQUEST_LIMIT,
            resolutions: allResolutions.length > 0 ? allResolutions : undefined,
            resolutionWarnings: allWarnings.length > 0 ? allWarnings : undefined,
            pendingConfirmations: allPendingConfirmations.length > 0 ? allPendingConfirmations : undefined,
            effectiveOffset: recencyResult.isActive ? 0 : effectiveOffset,
        };

        // Apply Change Info Field aliases to ticket read results.
        // Note: 'summary' applies aliases internally via buildTicketSummary — do not apply here.
        if (resource === 'ticket' && effectiveOperation !== 'summary') {
            const creds = await context.getCredentials('autotaskApi') as IAutotaskCredentials;
            if (shouldApplyAliases(creds)) {
                const aliasMap = buildAliasMap(creds);
                if (effectiveOperation === 'slaHealthCheck') {
                    const ticketData = (records[0] as Record<string, unknown>)?.ticket;
                    if (ticketData) applyChangeInfoAliases(ticketData as Record<string, unknown>, aliasMap);
                } else {
                    for (const rec of records) {
                        applyChangeInfoAliases(rec as Record<string, unknown>, aliasMap);
                    }
                }
            }
        }

        // Build structured response per operation type
        return formatToolResponse(resource, effectiveOperation, records, params, responseContext);
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
    resource: string,
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
            if (
                entity === null ||
                entity === undefined ||
                (Array.isArray(entity) && entity.length === 0) ||
                (typeof entity === 'object' && !Array.isArray(entity) && Object.keys(entity).length === 0)
            ) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, entity));
        }

        case 'getMany':
        case 'getPosted':
        case 'getUnposted': {
            const hasFilters = !!(
                params.filter_field ||
                params.filter_field_2 ||
                params.recency ||
                params.since ||
                params.until
            );
            if (hasFilters && records.length === 0) {
                const filtersUsed: Record<string, unknown> = {};
                if (params.filter_field) {
                    filtersUsed.filter_field = params.filter_field;
                    filtersUsed.filter_op = params.filter_op;
                    filtersUsed.filter_value = params.filter_value;
                }
                if (params.filter_field_2) {
                    filtersUsed.filter_field_2 = params.filter_field_2;
                    filtersUsed.filter_op_2 = params.filter_op_2;
                    filtersUsed.filter_value_2 = params.filter_value_2;
                }
                if (params.filter_logic && params.filter_logic !== 'and') filtersUsed.filter_logic = params.filter_logic;
                if (params.recency) filtersUsed.recency = params.recency;
                if (params.since) filtersUsed.since = params.since;
                if (params.until) filtersUsed.until = params.until;
                return JSON.stringify(formatNoResultsFound(resource, operation, filtersUsed));
            }
            const total = records.length;
            const truncated = total > MAX_RESPONSE_RECORDS;
            const items = truncated ? records.slice(0, MAX_RESPONSE_RECORDS) : records;
            const currentOffset = context.effectiveOffset ?? 0;
            const resultPayload: Record<string, unknown> = {
                items,
                count: items.length,
                offset: currentOffset,
            };
            const notes: string[] = [];
            if (context.recencyActive) {
                // Recency mode reverse-sorts the full window — offset pagination is not
                // meaningful, so suppress hasMore/nextOffset to prevent confusing the LLM.
                resultPayload.hasMore = false;
                if (truncated) {
                    resultPayload.truncated = true;
                    resultPayload.totalAvailable = total;
                    notes.push(
                        `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Use a narrower recency window or increase limit to see more.`,
                    );
                }
            } else if (truncated) {
                resultPayload.truncated = true;
                resultPayload.totalAvailable = total;
                const truncatedNextOffset = currentOffset + MAX_RESPONSE_RECORDS;
                resultPayload.hasMore = truncatedNextOffset < MAX_QUERY_LIMIT;
                if (resultPayload.hasMore) {
                    resultPayload.nextOffset = truncatedNextOffset;
                }
                notes.push(
                    resultPayload.hasMore
                        ? `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Use offset=${truncatedNextOffset} to see the next page, or use a narrower filter.`
                        : `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Offset pagination limit (${MAX_QUERY_LIMIT}) reached — use narrower filters to access more records.`,
                );
            } else if (items.length > 0) {
                const requestedLimit = getEffectiveLimit(params.limit);
                const nextOffset = currentOffset + items.length;
                // hasMore is true when we got a full page AND the next offset would be within API cap
                resultPayload.hasMore = items.length >= requestedLimit && nextOffset < MAX_QUERY_LIMIT;
                if (resultPayload.hasMore) {
                    resultPayload.nextOffset = nextOffset;
                }
            } else {
                resultPayload.hasMore = false;
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
                resultPayload.note = notes[0];
            } else if (notes.length > 1) {
                resultPayload.notes = notes;
                resultPayload.note = notes.join(' ');
            }
            if (context.resolutions && context.resolutions.length > 0) {
                resultPayload.resolvedLabels = context.resolutions;
            }
            if (context.resolutionWarnings && context.resolutionWarnings.length > 0) {
                resultPayload.resolutionWarnings = context.resolutionWarnings;
            }
            if (context.pendingConfirmations && context.pendingConfirmations.length > 0) {
                resultPayload.pendingConfirmations = context.pendingConfirmations;
            }
            return JSON.stringify(wrapSuccess(resource, operation, resultPayload));
        }

        case 'whoAmI': {
            if (firstRecord === null || firstRecord === undefined) {
                return JSON.stringify(formatNotFoundError(resource, operation, 'authenticated user'));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'searchByDomain': {
            if (firstRecord === null || firstRecord === undefined) {
                return JSON.stringify(wrapError(
                    resource, operation, ERROR_TYPES.ENTITY_NOT_FOUND,
                    'No company found matching the supplied domain.',
                    `Verify the domain and retry, or use autotask_${resource} with operation 'getMany' with a filter.`,
                ));
            }
            if (records.length > 1) {
                return JSON.stringify(wrapSuccess(resource, operation, { items: records, count: records.length }));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'slaHealthCheck': {
            if (firstRecord === null || firstRecord === undefined) {
                const identifier = params.ticketNumber ?? params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, identifier as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'summary': {
            if (firstRecord === null || firstRecord === undefined) {
                const identifier = params.ticketNumber ?? params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, identifier as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'moveConfigurationItem': {
            if (firstRecord === null || firstRecord === undefined) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'moveToCompany': {
            if (firstRecord === null || firstRecord === undefined) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'approve': {
            if (firstRecord === null || firstRecord === undefined) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'reject': {
            if (firstRecord === null || firstRecord === undefined) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'transferOwnership': {
            if (firstRecord === null || firstRecord === undefined) {
                return JSON.stringify(wrapError(
                    resource, operation, ERROR_TYPES.ENTITY_NOT_FOUND,
                    'Transfer ownership returned no result.',
                    `Verify source and destination resource IDs, then retry.`,
                ));
            }
            return JSON.stringify(wrapSuccess(resource, operation, firstRecord));
        }

        case 'count': {
            const countValue = records[0]?.count ?? records.length;
            return JSON.stringify(wrapSuccess(resource, operation, { count: countValue }));
        }

        case 'create': {
            const operationId = extractOperationId(firstRecord);
            const createResult: Record<string, unknown> = {
                itemId: operationId,
                entity: firstRecord,
            };
            if (context.resolutions && context.resolutions.length > 0) {
                createResult.resolvedLabels = context.resolutions;
            }
            if (context.resolutionWarnings && context.resolutionWarnings.length > 0) {
                createResult.resolutionWarnings = context.resolutionWarnings;
            }
            if (context.pendingConfirmations && context.pendingConfirmations.length > 0) {
                createResult.pendingConfirmations = context.pendingConfirmations;
            }
            return JSON.stringify(wrapSuccess(resource, operation, createResult));
        }

        case 'update': {
            const operationId = extractOperationId(firstRecord);
            const updateResult: Record<string, unknown> = {
                itemId: operationId,
                entity: firstRecord,
            };
            if (context.resolutions && context.resolutions.length > 0) {
                updateResult.resolvedLabels = context.resolutions;
            }
            if (context.resolutionWarnings && context.resolutionWarnings.length > 0) {
                updateResult.resolutionWarnings = context.resolutionWarnings;
            }
            if (context.pendingConfirmations && context.pendingConfirmations.length > 0) {
                updateResult.pendingConfirmations = context.pendingConfirmations;
            }
            return JSON.stringify(wrapSuccess(resource, operation, updateResult));
        }

        case 'delete': {
            const id = params.id;
            return JSON.stringify(wrapSuccess(resource, operation, {
                id,
                deleted: true,
            }));
        }

        case 'getByResource': {
            const entity = firstRecord;
            if (
                entity === null ||
                entity === undefined ||
                (typeof entity === 'object' && !Array.isArray(entity) && Object.keys(entity as object).length === 0)
            ) {
                const rid = params.resourceID ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, rid as number | string));
            }
            return JSON.stringify(wrapSuccess(resource, operation, entity));
        }

        case 'getByYear': {
            const entity = firstRecord;
            if (
                entity === null ||
                entity === undefined ||
                (typeof entity === 'object' && !Array.isArray(entity) && Object.keys(entity as object).length === 0)
            ) {
                const rid = params.resourceID ?? 'unknown';
                const yr = params.year ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, `resource ${rid}, year ${yr}`));
            }
            return JSON.stringify(wrapSuccess(resource, operation, entity));
        }

        default:
            return JSON.stringify(wrapError(
                resource, operation, ERROR_TYPES.INVALID_OPERATION,
                `Unknown operation '${operation}'.`,
                `Use a supported operation for autotask_${resource}.`,
            ));
    }
}
