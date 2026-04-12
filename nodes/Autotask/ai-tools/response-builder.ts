import type { FieldMeta } from '../helpers/aiHelper';
import type {
    LabelResolution,
    PendingLabelConfirmation,
} from '../helpers/label-resolution';
import { getAiIdentityProfile } from '../constants/ai-identity';

export interface ToolResponseContext {
    resource?: string;
    recencyActive?: boolean;
    recencyWindowLimited?: boolean;
    recencyNote?: string;
    resolutions?: LabelResolution[];
    resolutionWarnings?: string[];
    pendingConfirmations?: PendingLabelConfirmation[];
    effectiveOffset?: number;
    readFields?: FieldMeta[];
}

export function attachCorrelation(json: string, id: string | undefined): string {
    if (!id) return json;
    try {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        return JSON.stringify({ correlationId: id, ...parsed });
    } catch {
        return json;
    }
}

function getFieldValue(
    entity: Record<string, unknown>,
    fields: string[],
): string | number | undefined {
    for (const field of fields) {
        const value = entity[field];
        if (
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim() !== '')
        ) {
            return value;
        }
    }
    return undefined;
}

function getFieldValueByKeyPattern(
    entity: Record<string, unknown>,
    pattern: RegExp,
): string | number | undefined {
    // Pattern fallback keeps identity extraction resilient when schema-selected fields vary.
    for (const [key, value] of Object.entries(entity)) {
        if (!pattern.test(key)) continue;
        if (
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim() !== '')
        ) {
            return value;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Flat Response Standard (v2) — shared types and helpers
// ---------------------------------------------------------------------------

export interface ResolvedLabel {
    field: string;
    from: string | number;
    to: string | number;
}

export function toResolvedLabels(resolutions?: LabelResolution[]): ResolvedLabel[] {
    return (resolutions ?? []).map(({ field, from, to }) => ({ field, from, to }));
}

export interface ListPaginationState {
    hasMore: boolean;
    nextOffset?: number;
    totalAvailable?: number;
    notes?: string[];
}

// ---------------------------------------------------------------------------
// Identity string builder (internal)
// ---------------------------------------------------------------------------

function buildIdentityString(
    resource: string,
    entity: Record<string, unknown>,
): string {
    const profile = getAiIdentityProfile(resource);
    const humanId =
        getFieldValue(entity, profile.humanIdentifierFields ?? []) ??
        getFieldValueByKeyPattern(entity, /Number$|Code$|Reference$/i);
    const titleVal =
        getFieldValue(entity, profile.titleLikeFields ?? []) ??
        getFieldValueByKeyPattern(entity, /Name$|Title$|Subject$|DisplayName$/i);
    const id = entity.id ?? entity.itemId;
    const parts: string[] = [];
    if (humanId !== undefined) parts.push(String(humanId));
    if (titleVal !== undefined) parts.push(String(titleVal));
    const descriptor = parts.join(' — ');
    if (descriptor && id !== undefined) return `${descriptor} (ID: ${id})`;
    if (descriptor) return descriptor;
    if (id !== undefined) return `(ID: ${id})`;
    return '';
}

// ---------------------------------------------------------------------------
// Flat success response builders
// ---------------------------------------------------------------------------

export function buildListResponse(
    resource: string,
    operation: string,
    records: Record<string, unknown>[],
    pagination: ListPaginationState,
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const count = records.length;
    let terminationSignal: string;
    if (pagination.totalAvailable !== undefined) {
        terminationSignal = `truncated — ${pagination.totalAvailable} total matched, limit reached. Use narrower filters`;
    } else if (pagination.hasMore) {
        terminationSignal = `more available. Use nextOffset: ${pagination.nextOffset} to continue`;
    } else {
        terminationSignal = 'complete set, no further calls needed';
    }
    const opPrefix =
        operation === 'getPosted' ? 'posted '
        : operation === 'getUnposted' ? 'unposted '
        : '';
    const summary = `Found ${count} ${opPrefix}${resource} records — ${terminationSignal}.`;
    const response: Record<string, unknown> = {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        records,
        returnedCount: count,
        hasMore: pagination.hasMore,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
    if (pagination.nextOffset !== undefined) response.nextOffset = pagination.nextOffset;
    if (pagination.totalAvailable !== undefined) response.totalAvailable = pagination.totalAvailable;
    if (pagination.notes && pagination.notes.length > 0) response.notes = pagination.notes;
    return response;
}

/**
 * Flat response for single-record reads: get, getByResource, getByYear, whoAmI.
 * @param verb  Verb used in summary: "Retrieved" (default) | "Authenticated as"
 */
export function buildItemResponse(
    resource: string,
    operation: string,
    record: Record<string, unknown>,
    options: { verb?: string } = {},
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const verb = options.verb ?? 'Retrieved';
    const identity = buildIdentityString(resource, record);
    const summary = identity
        ? `${verb} ${resource} ${identity}.`
        : `${verb} ${resource} (ID: ${record.id ?? 'unknown'}).`;
    return {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        record,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
}

/**
 * Flat response for create, update, approve, reject, moveToCompany,
 * moveConfigurationItem, transferOwnership.
 * Pass `record` when the API returns the updated entity; omit for operations
 * that return no entity (e.g. some update variants).
 */
export function buildMutationResponse(
    resource: string,
    operation: string,
    id: number | string,
    record?: Record<string, unknown>,
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const opVerb =
        operation === 'create' ? 'Created'
        : operation === 'update' ? 'Updated'
        : operation === 'approve' ? 'Approved'
        : operation === 'reject' ? 'Rejected'
        : operation === 'post' ? 'Posted'
        : operation === 'moveToCompany' ? 'Moved to company for'
        : operation === 'moveConfigurationItem' ? 'Moved configuration item for'
        : operation === 'transferOwnership' ? 'Transferred ownership for'
        : operation.endsWith('e')
            ? operation.charAt(0).toUpperCase() + operation.slice(1) + 'd'
            : operation.charAt(0).toUpperCase() + operation.slice(1) + 'ed';
    const identity = record ? buildIdentityString(resource, record) : '';
    const summary = identity
        ? `${opVerb} ${resource} ${identity} successfully.`
        : `${opVerb} ${resource} (ID: ${id}) successfully.`;
    const response: Record<string, unknown> = {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        id,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
    if (record) response.record = record;
    return response;
}

/** Flat response for delete (no entity returned). */
export function buildDeleteResponse(
    resource: string,
    operation: string,
    id: number | string,
    context: ToolResponseContext = {},
): Record<string, unknown> {
    return {
        summary: `Deleted ${resource} (ID: ${id}) successfully.`,
        resource,
        operation: `${resource}.${operation}`,
        id,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
}

export function buildCountResponse(
    resource: string,
    operation: string,
    matchCount: number,
): Record<string, unknown> {
    return {
        summary: `${matchCount} ${resource} records match the filter.`,
        resource,
        operation: `${resource}.${operation}`,
        matchCount,
        warnings: [],
    };
}

export function buildCompoundResponse(
    resource: string,
    operation: string,
    compoundData: {
        outcome: string;
        id?: number | string;
        existingId?: number | string;
        record?: Record<string, unknown>;
        matchedDedupFields?: string[];
        fieldsUpdated?: Record<string, unknown>;
        fieldsCompared?: Record<string, unknown>;
        context?: Record<string, unknown>;
    },
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const { outcome, id, existingId, record, matchedDedupFields, fieldsUpdated, fieldsCompared } = compoundData;
    const canonicalId = id ?? existingId;
    let summary: string;
    if (outcome === 'created') {
        summary = `${resource} created (ID: ${canonicalId}).`;
    } else if (outcome === 'skipped') {
        summary = `${resource} already exists (skipped). Existing ID: ${canonicalId}.`;
    } else if (outcome === 'updated') {
        const count = fieldsUpdated ? Object.keys(fieldsUpdated).length : 0;
        summary = `${resource} updated (ID: ${canonicalId}). ${count} field${count !== 1 ? 's' : ''} changed.`;
    } else {
        summary = `${resource} could not be processed — ${outcome}${canonicalId !== undefined ? ` (ID: ${canonicalId})` : ''}.`;
    }
    const response: Record<string, unknown> = {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        outcome,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
    if (canonicalId !== undefined) response.id = canonicalId;
    if (record) response.record = record;
    if (matchedDedupFields !== undefined) response.matchedDedupFields = matchedDedupFields;
    if (fieldsCompared !== undefined) response.fieldsCompared = fieldsCompared;
    if (fieldsUpdated !== undefined) response.fieldsUpdated = fieldsUpdated;
    return response;
}

type MetadataPayload =
    | { kind: 'describeFields'; fields: FieldMeta[]; mode: string }
    | { kind: 'listPicklistValues'; fieldId: string; picklistValues: unknown[] }
    | { kind: 'describeOperation'; operationDoc: unknown; targetOperation: string };

export function buildMetadataResponse(
    resource: string,
    operation: string,
    payload: MetadataPayload,
): Record<string, unknown> {
    if (payload.kind === 'describeFields') {
        const { fields, mode } = payload;
        const requiredFields = fields.filter((f) => f.required);
        const requiredSummary = requiredFields
            .slice(0, 5)
            .map((f) => {
                if (f.isReference && f.referencesEntity) return `${f.id} (ref→${f.referencesEntity})`;
                if (f.isPickList) return `${f.id} (picklist)`;
                return `${f.id} (${f.type ?? 'unknown'})`;
            })
            .join(', ');
        const overflow = requiredFields.length > 5 ? ` (+${requiredFields.length - 5} more)` : '';
        const summary = requiredFields.length > 0
            ? `${resource} has ${fields.length} fields. Required for ${mode}: ${requiredSummary}${overflow}.`
            : `${resource} has ${fields.length} fields. No required fields for ${mode}.`;
        return {
            summary,
            resource,
            operation: `${resource}.${operation}`,
            fields,
            warnings: [],
        };
    }

    if (payload.kind === 'listPicklistValues') {
        const { fieldId, picklistValues } = payload;
        const activeCount = (picklistValues as Array<{ isActive?: boolean }>).filter(
            (v) => v.isActive !== false,
        ).length;
        return {
            summary: `Field '${fieldId}' has ${activeCount} active picklist values.`,
            resource,
            operation: `${resource}.${operation}`,
            picklistValues,
            warnings: [],
        };
    }

    // kind === 'describeOperation'
    const { operationDoc, targetOperation } = payload;
    const purpose =
        operationDoc &&
        typeof operationDoc === 'object' &&
        'purpose' in operationDoc &&
        typeof (operationDoc as Record<string, unknown>).purpose === 'string'
            ? (operationDoc as Record<string, unknown>).purpose as string
            : `performs ${targetOperation}.`;
    const purposeText = purpose.endsWith('.') ? purpose : `${purpose}.`;
    return {
        summary: `Operation '${targetOperation}' on ${resource}: ${purposeText}`,
        resource,
        operation: `${resource}.${operation}`,
        operationDoc,
        warnings: [],
    };
}

export function buildSlaHealthCheckResponse(
    resource: string,
    operation: string,
    record: Record<string, unknown>,
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const ticket = record.ticket as Record<string, unknown> | undefined;
    const ticketNumber = ticket?.ticketNumber as string | undefined;
    const wallClockHours =
        typeof record.wallClockRemainingHours === 'number'
            ? record.wallClockRemainingHours.toFixed(1)
            : undefined;
    const isBreached = record.isBreached === true;
    const ticketRef =
        ticketNumber ?? (ticket?.id !== undefined ? `ticket ID: ${ticket.id}` : 'unknown ticket');
    const parts: string[] = [];
    if (wallClockHours !== undefined) parts.push(`${wallClockHours}h remaining`);
    parts.push(isBreached ? 'BREACHED' : 'not breached');
    const summary = `SLA health check for ${ticketRef}: ${parts.join(', ')}.`;
    return {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        record,
        resolvedLabels: toResolvedLabels(context.resolutions),
        pendingConfirmations: context.pendingConfirmations ?? [],
        warnings: context.resolutionWarnings ?? [],
    };
}

export function buildTicketSummaryResponse(
    resource: string,
    operation: string,
    record: Record<string, unknown>,
    context: ToolResponseContext = {},
): Record<string, unknown> {
    const core = record.core as Record<string, unknown> | undefined;
    const computed = record.computed as Record<string, unknown> | undefined;
    const ticketNumber = core?.ticketNumber as string | undefined;
    const title = core?.title as string | undefined;
    const ageHours =
        typeof computed?.ageHours === 'number' ? computed.ageHours.toFixed(1) : undefined;
    const isBreached = computed?.isOverdue === true;
    const identityParts: string[] = [];
    if (ticketNumber) identityParts.push(ticketNumber);
    if (title) identityParts.push(`— ${title}`);
    const detailParts: string[] = [];
    if (ageHours !== undefined) detailParts.push(`Age: ${ageHours}h`);
    detailParts.push(isBreached ? 'SLA: breached' : 'SLA: not breached');
    const identityStr = identityParts.join(' ') || 'Ticket';
    const summary = `${identityStr} (${detailParts.join(', ')}).`;
    return {
        summary,
        resource,
        operation: `${resource}.${operation}`,
        ticketSummary: record,
        warnings: context.resolutionWarnings ?? [],
    };
}
