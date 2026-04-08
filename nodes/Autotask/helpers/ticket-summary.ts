import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { applyChangeInfoAliases } from './change-info-aliases';

// ---------------------------------------------------------------------------
// Local helpers (minimal — mirrors private helpers in execute.ts)
// ---------------------------------------------------------------------------

function parseDateValue(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}

function roundN(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Ticket type detection
// ---------------------------------------------------------------------------

function detectTicketType(ticket: Record<string, unknown>): string {
    const label = String(ticket.ticketType_label ?? '').toLowerCase();
    if (label.includes('change request')) return 'Change Request';
    if (label.includes('incident')) return 'Incident';
    if (label.includes('problem')) return 'Problem';
    if (label.includes('service request')) return 'Service Request';
    if (label.includes('alert')) return 'Alert';
    const numType = Number(ticket.ticketType);
    if (numType === 4) return 'Change Request';
    if (numType === 2) return 'Incident';
    if (numType === 3) return 'Problem';
    if (numType === 1) return 'Service Request';
    if (numType === 5) return 'Alert';
    return 'Unknown';
}

// ---------------------------------------------------------------------------
// Field ordering
// ---------------------------------------------------------------------------

const UNIVERSAL_FIELDS = [
    'id', 'ticketNumber', 'title', 'status', 'status_label',
    'ticketType', 'ticketType_label', 'priority', 'priority_label',
    'companyID', 'companyID_label',
];

const TYPE_PRIORITY_FIELDS: Record<string, string[]> = {
    'Change Request': [
        'changeApprovalBoard', 'changeApprovalBoard_label',
        'changeApprovalStatus', 'changeApprovalStatus_label',
        'changeApprovalType', 'changeApprovalType_label',
    ],
    'Incident': [
        'urgency', 'urgency_label', 'impact', 'impact_label',
        'assignedResourceID', 'assignedResourceID_label',
        'assignedResourceRoleID', 'assignedResourceRoleID_label',
        'queueID', 'queueID_label',
        'firstResponseDueDateTime', 'firstResponseDateTime',
        'resolvedDueDateTime', 'resolvedDateTime',
        'serviceLevelAgreementID', 'serviceLevelAgreementID_label',
    ],
};

const DEFAULT_TYPE_PRIORITY_FIELDS = [
    'assignedResourceID', 'assignedResourceID_label',
    'queueID', 'queueID_label',
    'dueDateTime', 'estimatedHours',
];

function buildOrderedSummary(
    filteredTicket: Record<string, unknown>,
    detectedType: string,
): Record<string, unknown> {
    const placed = new Set<string>();
    const ordered: Record<string, unknown> = {};

    // 1. Universal fields
    for (const key of UNIVERSAL_FIELDS) {
        if (key in filteredTicket) {
            ordered[key] = filteredTicket[key];
            placed.add(key);
        }
    }

    // 2. Type-specific priority fields
    let typePriorityFields: string[];
    if (detectedType === 'Change Request') {
        const baseFields = TYPE_PRIORITY_FIELDS['Change Request'];
        // Also include all changeInfoField* keys (originals first, then alias copies)
        const changeInfoOriginals = Object.keys(filteredTicket).filter(
            (k) => /^changeInfoField\d+$/.test(k),
        ).sort();
        const changeInfoAliases = Object.keys(filteredTicket).filter(
            (k) => /^changeInfoField\d+_/.test(k),
        ).sort();
        typePriorityFields = [...baseFields, ...changeInfoOriginals, ...changeInfoAliases];
    } else if (detectedType === 'Incident') {
        typePriorityFields = TYPE_PRIORITY_FIELDS['Incident'];
    } else {
        typePriorityFields = DEFAULT_TYPE_PRIORITY_FIELDS;
    }

    for (const key of typePriorityFields) {
        if (key in filteredTicket && !placed.has(key)) {
            ordered[key] = filteredTicket[key];
            placed.add(key);
        }
    }

    // 3. Remaining keys in natural insertion order
    for (const key of Object.keys(filteredTicket)) {
        if (!placed.has(key)) {
            ordered[key] = filteredTicket[key];
        }
    }

    return ordered;
}

// ---------------------------------------------------------------------------
// Computed block
// ---------------------------------------------------------------------------

function buildComputedBlock(
    ticket: Record<string, unknown>,
    now: Date,
): Record<string, unknown> {
    const computed: Record<string, unknown> = {};

    // ageHours
    const createDate = parseDateValue(ticket.createDate ?? ticket.createDateTime);
    if (createDate) {
        computed.ageHours = roundN((now.getTime() - createDate.getTime()) / 3600000, 2);
    }

    // daysSinceLastActivity
    const lastActivity = parseDateValue(ticket.lastActivityDateTime ?? ticket.lastActivityDate);
    if (lastActivity) {
        computed.daysSinceLastActivity = roundN((now.getTime() - lastActivity.getTime()) / 86400000, 1);
    }

    // isAssigned
    const resourceId = ticket.assignedResourceID;
    if (resourceId !== undefined && resourceId !== null) {
        computed.isAssigned = resourceId !== '' && resourceId !== 0;
    }

    // isOverdue and hoursUntilDue
    const dueDate = parseDateValue(ticket.dueDateTime as string | undefined);
    const resolvedDate = parseDateValue(ticket.resolvedDateTime as string | undefined);
    if (dueDate) {
        if (!resolvedDate) {
            // Ticket is open
            computed.isOverdue = now.getTime() > dueDate.getTime();
            computed.hoursUntilDue = roundN((dueDate.getTime() - now.getTime()) / 3600000, 2);
        } else {
            computed.isOverdue = false;
        }
    }

    // slaStatus
    const slaId = ticket.serviceLevelAgreementID;
    if (slaId === undefined || slaId === null || slaId === '') {
        computed.slaStatus = 'No SLA';
    } else {
        const slaMet = ticket.serviceLevelAgreementHasBeenMet;
        const pausedHours = Number(ticket.serviceLevelAgreementPausedNextEventHours ?? 0);
        if (slaMet === true) {
            computed.slaStatus = 'Met';
        } else if (pausedHours > 0) {
            computed.slaStatus = 'Paused';
        } else {
            const resolvedDue = parseDateValue(ticket.resolvedDueDateTime as string | undefined);
            if (!resolvedDue) {
                computed.slaStatus = 'Pending';
            } else if (now.getTime() > resolvedDue.getTime()) {
                computed.slaStatus = 'Breached';
            } else if (createDate) {
                const elapsed = (now.getTime() - createDate.getTime());
                const remaining = resolvedDue.getTime() - now.getTime();
                const total = elapsed + remaining;
                if (total > 0 && remaining / total < 0.25) {
                    computed.slaStatus = 'At Risk';
                } else {
                    computed.slaStatus = 'On Track';
                }
            } else {
                const remaining = roundN((resolvedDue.getTime() - now.getTime()) / 3600000, 2);
                computed.slaStatus = remaining <= 1 ? 'At Risk' : 'On Track';
            }
        }
    }

    // slaNextDueHours — smallest positive hours among unmet milestone due dates
    const milestoneFields = ['firstResponseDueDateTime', 'resolutionPlanDueDateTime', 'resolvedDueDateTime'];
    let smallestDue: number | undefined;
    for (const field of milestoneFields) {
        const milestoneDate = parseDateValue(ticket[field] as string | undefined);
        if (milestoneDate) {
            const hours = roundN((milestoneDate.getTime() - now.getTime()) / 3600000, 2);
            if (smallestDue === undefined || hours < smallestDue) {
                smallestDue = hours;
            }
        }
    }
    if (smallestDue !== undefined) {
        computed.slaNextDueHours = smallestDue;
    }

    return computed;
}

// ---------------------------------------------------------------------------
// Relationships block
// ---------------------------------------------------------------------------

function buildRelationshipsBlock(
    ticket: Record<string, unknown>,
): Record<string, unknown> | null {
    const rel: Record<string, Record<string, unknown>> = {};
    if (ticket.problemTicketId != null && ticket.problemTicketId !== '') {
        rel.linkedProblem = { ticketId: ticket.problemTicketId };
    }
    if (ticket.projectID != null && ticket.projectID !== '') {
        rel.project = { projectId: ticket.projectID };
    }
    if (ticket.opportunityID != null && ticket.opportunityID !== '') {
        rel.opportunity = { opportunityId: ticket.opportunityID };
    }
    return Object.keys(rel).length > 0 ? rel : null;
}

// ---------------------------------------------------------------------------
// Count helper
// ---------------------------------------------------------------------------

interface CountError {
    entity: string;
    error: string;
}

async function fetchCount(
    context: IExecuteFunctions,
    endpoint: string,
    filter: IDataObject[],
): Promise<number> {
    const response = await autotaskApiRequest.call(
        context,
        'POST',
        endpoint,
        { filter } as unknown as IDataObject,
    ) as { queryCount?: number };
    return typeof response.queryCount === 'number' ? response.queryCount : 0;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TicketSummaryOptions {
    includeRaw: boolean;
    summaryTextLimit: number;
}

export interface TicketSummaryResult {
    summary: Record<string, unknown>;
    computed: Record<string, unknown>;
    relationships?: Record<string, unknown>;
    childCounts: Record<string, unknown>;
    raw?: Record<string, unknown>;
    _meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildTicketSummary(
    context: IExecuteFunctions,
    ticket: Record<string, unknown>,
    childCountsInput: Record<string, unknown>,
    options: TicketSummaryOptions,
    aliasMap: Map<number, string> | null,
    now: Date,
): Promise<TicketSummaryResult> {
    const { includeRaw, summaryTextLimit } = options;

    // Step 1: Apply aliases — then remove originals to avoid duplicate noise
    if (aliasMap) {
        applyChangeInfoAliases(ticket, aliasMap);
        for (let n = 1; n <= 5; n++) {
            delete ticket[`changeInfoField${n}`];
        }
    }

    // Step 2: Save raw copy (post-alias, pre-filter)
    const rawTicket: Record<string, unknown> = { ...ticket };

    // Step 3: Detect ticket type (before filtering so all fields are available)
    const detectedType = detectTicketType(ticket);

    // Step 4: Text truncation for description and resolution
    const truncatedFields: Array<{ field: string; originalLength: number; charsRemoved: number }> = [];

    function maybeTruncate(value: unknown, fieldName: string): unknown {
        if (typeof value !== 'string') return value;
        if (summaryTextLimit <= 0 || value.length <= summaryTextLimit) return value;
        const originalLength = value.length;
        const charsRemoved = originalLength - summaryTextLimit;
        truncatedFields.push({ field: fieldName, originalLength, charsRemoved });
        return `${value.slice(0, summaryTextLimit)}\u2026[truncated, ${originalLength} chars total]`;
    }

    if ('description' in ticket) {
        ticket.description = maybeTruncate(ticket.description, 'description');
    }
    if ('resolution' in ticket) {
        ticket.resolution = maybeTruncate(ticket.resolution, 'resolution');
    }

    // Step 5: Filter null/empty-string/empty-array fields
    const filteredTicket: Record<string, unknown> = {};
    const excludedFieldNames: string[] = [];

    for (const [key, value] of Object.entries(ticket)) {
        if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
            excludedFieldNames.push(key);
        } else {
            filteredTicket[key] = value;
        }
    }

    // Step 6: Build ordered summary
    const summary = buildOrderedSummary(filteredTicket, detectedType);

    // Step 7: Build computed block
    const computed = buildComputedBlock(ticket, now);

    // Step 8: Build relationships block
    const relationships = buildRelationshipsBlock(ticket);

    // Step 9: Assemble childCounts — omit zero-value keys
    const childCounts: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(childCountsInput)) {
        if (key === 'checklistItems') {
            // Keep checklistItems object if total > 0
            const ci = value as Record<string, number>;
            if (ci && typeof ci === 'object' && (ci.total ?? 0) > 0) {
                childCounts.checklistItems = ci;
            }
        } else if (typeof value === 'number' && value > 0) {
            childCounts[key] = value;
        }
    }

    // Step 10: Build _meta
    const meta: Record<string, unknown> = {
        detectedTicketType: detectedType,
        typeAwarePrioritisationApplied: true,
        aliasesApplied: aliasMap !== null,
        summaryTextLimit,
        excludedFieldCount: excludedFieldNames.length,
        excludedFieldNames,
        source: 'ticket.summary',
        generatedAt: now.toISOString(),
    };

    if (truncatedFields.length > 0) {
        meta.truncatedFields = truncatedFields;
    }

    const countErrors = (childCountsInput._countErrors ?? []) as CountError[];
    if (countErrors.length > 0) {
        meta.countErrors = countErrors;
    }

    const slaId = ticket.serviceLevelAgreementID;
    meta.slaDetailAvailable = slaId !== null && slaId !== undefined && slaId !== '';

    // Step 11: Assemble result
    const result: TicketSummaryResult = {
        summary,
        computed,
        childCounts,
        _meta: meta,
    };

    if (relationships) {
        result.relationships = relationships;
    }

    if (includeRaw) {
        result.raw = rawTicket;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Count fetching — called from execute.ts
// ---------------------------------------------------------------------------

export async function fetchTicketChildCounts(
    context: IExecuteFunctions,
    ticketId: number | string,
    detectedType: string,
): Promise<{ counts: Record<string, unknown>; errors: Array<{ entity: string; error: string }> }> {
    const id = Number(ticketId);
    const ticketFilter = [{ field: 'ticketID', op: 'eq', value: id }];
    const errors: Array<{ entity: string; error: string }> = [];

    const safeCount = async (entity: string, endpoint: string, filter: IDataObject[]): Promise<number | null> => {
        try {
            return await fetchCount(context, endpoint, filter);
        } catch (err) {
            errors.push({ entity, error: err instanceof Error ? err.message : String(err) });
            return null;
        }
    };

    // Parallel fetches — all except conditional changeRequestLinks and checklist split
    const [
        notes,
        timeEntries,
        attachments,
        additionalCIs,
        additionalContacts,
        checklistTotal,
        checklistCompleted,
    ] = await Promise.all([
        safeCount('notes', 'TicketNotes/query/count', ticketFilter),
        safeCount('timeEntries', 'TimeEntries/query/count', ticketFilter),
        safeCount('attachments', 'TicketAttachments/query/count', [{ field: 'parentId', op: 'eq', value: id }]),
        safeCount('additionalConfigurationItems', 'TicketAdditionalConfigurationItems/query/count', ticketFilter),
        safeCount('additionalContacts', 'TicketAdditionalContacts/query/count', ticketFilter),
        safeCount('checklistTotal', 'TicketChecklistItems/query/count', ticketFilter),
        safeCount('checklistCompleted', 'TicketChecklistItems/query/count', [
            { field: 'ticketID', op: 'eq', value: id },
            { field: 'isCompleted', op: 'eq', value: true },
        ]),
    ]);

    // Optional: changeRequestLinks only for CR tickets
    let changeRequestLinks: number | null = null;
    if (detectedType === 'Change Request') {
        changeRequestLinks = await safeCount(
            'changeRequestLinks',
            'ChangeRequestLinks/query/count',
            [{ field: 'changeRequestTicketID', op: 'eq', value: id }],
        );
    }

    const counts: Record<string, unknown> = {};
    if (notes !== null) counts.notes = notes;
    if (timeEntries !== null) counts.timeEntries = timeEntries;
    if (attachments !== null) counts.attachments = attachments;
    if (additionalCIs !== null) counts.additionalConfigurationItems = additionalCIs;
    if (additionalContacts !== null) counts.additionalContacts = additionalContacts;
    if (changeRequestLinks !== null) counts.changeRequestLinks = changeRequestLinks;

    // Checklist items as nested object
    if (checklistTotal !== null) {
        const total = checklistTotal;
        const completed = checklistCompleted ?? 0;
        counts.checklistItems = {
            total,
            completed,
            remaining: total - completed,
        };
    }

    // Attach errors for _meta (filtered out from counts themselves)
    if (errors.length > 0) {
        counts._countErrors = errors;
    }

    return { counts, errors };
}
