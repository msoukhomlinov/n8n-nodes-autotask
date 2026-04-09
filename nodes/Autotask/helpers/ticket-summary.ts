import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { applyChangeInfoAliases } from './change-info-aliases';
import { detectTicketTypeDetailed, TicketType } from './ticket-type';
import { computeMilestoneStatus } from './sla-milestone';

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
        'assignedResourceID', 'assignedResourceID_label',
        'assignedResourceRoleID', 'assignedResourceRoleID_label',
        'queueID', 'queueID_label',
        'firstResponseDueDateTime', 'firstResponseDateTime',
        'resolvedDueDateTime', 'resolvedDateTime',
        'serviceLevelAgreementID', 'serviceLevelAgreementID_label',
    ],
    'Problem': [
        'assignedResourceID', 'assignedResourceID_label',
        'assignedResourceRoleID', 'assignedResourceRoleID_label',
        'queueID', 'queueID_label',
        'firstResponseDueDateTime', 'firstResponseDateTime',
        'resolvedDueDateTime', 'resolvedDateTime',
        'serviceLevelAgreementID', 'serviceLevelAgreementID_label',
    ],
    'Service Request': [
        'assignedResourceID', 'assignedResourceID_label',
        'assignedResourceRoleID', 'assignedResourceRoleID_label',
        'queueID', 'queueID_label',
        'dueDateTime', 'estimatedHours',
        'serviceLevelAgreementID', 'serviceLevelAgreementID_label',
        'firstResponseDueDateTime', 'firstResponseDateTime',
        'resolvedDueDateTime', 'resolvedDateTime',
    ],
    'Alert': [
        'assignedResourceID', 'assignedResourceID_label',
        'queueID', 'queueID_label',
        'dueDateTime',
        'firstResponseDueDateTime', 'firstResponseDateTime',
        'serviceLevelAgreementID', 'serviceLevelAgreementID_label',
    ],
};

const DEFAULT_TYPE_PRIORITY_FIELDS = [
    'assignedResourceID', 'assignedResourceID_label',
    'queueID', 'queueID_label',
    'dueDateTime', 'estimatedHours',
];

interface OrderedSummaryResult {
    ordered: Record<string, unknown>;
    prioritisedFields: string[];
}

function buildOrderedSummary(
    filteredTicket: Record<string, unknown>,
    detectedType: TicketType,
): OrderedSummaryResult {
    const placed = new Set<string>();
    const ordered: Record<string, unknown> = {};
    const prioritisedFields: string[] = [];

    // 1. Universal fields
    for (const key of UNIVERSAL_FIELDS) {
        if (key in filteredTicket) {
            ordered[key] = filteredTicket[key];
            placed.add(key);
            prioritisedFields.push(key);
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
    } else if (detectedType === 'Problem') {
        typePriorityFields = TYPE_PRIORITY_FIELDS['Problem'];
    } else if (detectedType === 'Service Request') {
        typePriorityFields = TYPE_PRIORITY_FIELDS['Service Request'];
    } else if (detectedType === 'Alert') {
        typePriorityFields = TYPE_PRIORITY_FIELDS['Alert'];
    } else {
        typePriorityFields = DEFAULT_TYPE_PRIORITY_FIELDS;
    }

    for (const key of typePriorityFields) {
        if (key in filteredTicket && !placed.has(key)) {
            ordered[key] = filteredTicket[key];
            placed.add(key);
            prioritisedFields.push(key);
        }
    }

    // 3. Remaining keys in natural insertion order
    for (const key of Object.keys(filteredTicket)) {
        if (!placed.has(key)) {
            ordered[key] = filteredTicket[key];
        }
    }

    return { ordered, prioritisedFields };
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

    // isOverdue / hoursUntilDue / hoursOverdue
    // Only emitted for open (unresolved) tickets. Resolved tickets omit these fields entirely.
    // hoursUntilDue: positive hours remaining (open, not yet overdue).
    // hoursOverdue: positive hours past due (open, overdue).
    const dueDate = parseDateValue(ticket.dueDateTime as string | undefined);
    const resolvedDate = parseDateValue(ticket.resolvedDateTime as string | undefined);
    if (dueDate && !resolvedDate) {
        const msRelative = dueDate.getTime() - now.getTime();
        const isOverdue = msRelative < 0;
        computed.isOverdue = isOverdue;
        if (isOverdue) {
            computed.hoursOverdue = roundN(-msRelative / 3600000, 2);
        } else {
            computed.hoursUntilDue = roundN(msRelative / 3600000, 2);
        }
    }

    // slaStatus — derived from per-milestone status using shared computeMilestoneStatus logic.
    // Ticket-level checks (No SLA, Met, Paused) take precedence over milestone derivation.
    // 'No SLA': no serviceLevelAgreementID (authoritative).
    // 'Met': serviceLevelAgreementHasBeenMet === true (API boolean, authoritative).
    // 'Paused': serviceLevelAgreementPausedNextEventHours > 0 (inferred from API field).
    // 'Breached': any unmet milestone is past due (inferred from milestone timestamps).
    // 'At Risk': any milestone is within 1 hour of due and not yet breached.
    // 'On Track': SLA active, not paused, no breach or risk, at least one milestone due date present.
    // 'Pending': SLA assigned but no milestone due dates computed yet.
    //
    // Note: elapsedHours and isMet are passed as null because ServiceLevelAgreementResults
    // are not fetched in ticket.summary (unlike slaHealthCheck which queries that entity).
    // computeMilestoneStatus falls back to wall-clock date comparison in that case.
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
            const milestoneDefs = [
                {
                    due: ticket.firstResponseDueDateTime as string | undefined,
                    actual: ticket.firstResponseDateTime as string | undefined,
                },
                {
                    due: ticket.resolutionPlanDueDateTime as string | undefined,
                    actual: ticket.resolutionPlanDateTime as string | undefined,
                },
                {
                    due: ticket.resolvedDueDateTime as string | undefined,
                    actual: ticket.resolvedDateTime as string | undefined,
                },
            ];

            type MilestoneResult = { status: string; wallClockRemainingHours: number | null };
            const milestoneResults: MilestoneResult[] = milestoneDefs.map(({ due, actual }) =>
                computeMilestoneStatus(due ?? null, actual ?? null, null, null, now),
            );

            let overallStatus = 'Pending';
            for (const { status } of milestoneResults) {
                if (status === 'Breached') { overallStatus = 'Breached'; break; }
                if (status === 'At Risk' && overallStatus !== 'Breached') overallStatus = 'At Risk';
                if ((status === 'On Track' || status === 'Met') && overallStatus === 'Pending') overallStatus = 'On Track';
            }
            computed.slaStatus = overallStatus;
        }
    }

    // slaNextMilestoneDueHours — hours until the next upcoming unmet SLA milestone (positive only).
    // Absent when no future unmet milestones exist.
    // slaEarliestBreachHours — hours since the earliest unmet overdue SLA milestone (positive magnitude).
    // Absent when no milestones are breached.
    // Both derived from wallClockRemainingHours returned by computeMilestoneStatus.
    // Note: only computed when SLA is assigned and not already 'Met' or 'Paused' at the ticket level.
    if (
        slaId !== undefined && slaId !== null && slaId !== '' &&
        ticket.serviceLevelAgreementHasBeenMet !== true &&
        Number(ticket.serviceLevelAgreementPausedNextEventHours ?? 0) <= 0
    ) {
        const milestoneDefs = [
            {
                due: ticket.firstResponseDueDateTime as string | undefined,
                actual: ticket.firstResponseDateTime as string | undefined,
            },
            {
                due: ticket.resolutionPlanDueDateTime as string | undefined,
                actual: ticket.resolutionPlanDateTime as string | undefined,
            },
            {
                due: ticket.resolvedDueDateTime as string | undefined,
                actual: ticket.resolvedDateTime as string | undefined,
            },
        ];

        let nextDueHours: number | undefined;
        let earliestBreachHours: number | undefined;

        for (const { due, actual } of milestoneDefs) {
            const result = computeMilestoneStatus(due ?? null, actual ?? null, null, null, now);
            const remaining = result.wallClockRemainingHours;
            if (remaining === null) continue;
            if (remaining >= 0) {
                if (nextDueHours === undefined || remaining < nextDueHours) {
                    nextDueHours = remaining;
                }
            } else {
                const breachHours = roundN(-remaining, 2);
                if (earliestBreachHours === undefined || breachHours > earliestBreachHours) {
                    earliestBreachHours = breachHours;
                }
            }
        }

        if (nextDueHours !== undefined) {
            computed.slaNextMilestoneDueHours = roundN(nextDueHours, 2);
        }
        if (earliestBreachHours !== undefined) {
            computed.slaEarliestBreachHours = earliestBreachHours;
        }
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
    includeChildCounts: boolean;
}

export interface TicketSummaryResult {
    summary: Record<string, unknown>;
    computed: Record<string, unknown>;
    relationships?: Record<string, unknown>;
    childCounts?: Record<string, unknown>;
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
    const { includeRaw, summaryTextLimit, includeChildCounts } = options;

    // Step 1: Capture the original ticket as raw output (unmodified snapshot).
    const rawTicket: Record<string, unknown> = { ...ticket };

    // Step 2: Clone into a working copy — all enrichment and transformation happens here.
    // The input `ticket` is never mutated.
    const working: Record<string, unknown> = { ...ticket };

    const suppressedCanonicalFields: string[] = [];
    const metaAliasMap: Record<string, string> = {};

    // Step 3: Apply aliases to the working copy, then drop the canonical originals from it.
    if (aliasMap) {
        applyChangeInfoAliases(working, aliasMap);
        for (let n = 1; n <= 5; n++) {
            const canonicalKey = `changeInfoField${n}`;
            if (canonicalKey in rawTicket) {
                const alias = aliasMap.get(n);
                if (alias) {
                    suppressedCanonicalFields.push(canonicalKey);
                    metaAliasMap[canonicalKey] = `${canonicalKey}_${alias}`;
                }
            }
            delete working[canonicalKey];
        }
    }

    // Step 4: Detect ticket type from the working copy (aliases already applied).
    const detection = detectTicketTypeDetailed(working);
    const detectedType = detection.type;

    // Step 5: Text truncation for description and resolution on the working copy.
    const truncatedFields: Array<{ field: string; originalLength: number; charsRemoved: number }> = [];

    function maybeTruncate(value: unknown, fieldName: string): unknown {
        if (typeof value !== 'string') return value;
        if (summaryTextLimit <= 0 || value.length <= summaryTextLimit) return value;
        const originalLength = value.length;
        const charsRemoved = originalLength - summaryTextLimit;
        truncatedFields.push({ field: fieldName, originalLength, charsRemoved });
        return `${value.slice(0, summaryTextLimit)}\u2026[truncated, ${originalLength} chars total]`;
    }

    if ('description' in working) {
        working.description = maybeTruncate(working.description, 'description');
    }
    if ('resolution' in working) {
        working.resolution = maybeTruncate(working.resolution, 'resolution');
    }

    // Step 6: Filter null/empty-string/empty-array fields from the working copy.
    const filteredTicket: Record<string, unknown> = {};
    const excludedFieldNames: string[] = [];

    for (const [key, value] of Object.entries(working)) {
        if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
            excludedFieldNames.push(key);
        } else {
            filteredTicket[key] = value;
        }
    }

    // Step 7: Build ordered summary from the filtered working copy.
    const { ordered: summary, prioritisedFields } = buildOrderedSummary(filteredTicket, detectedType);

    // Step 8: Build computed block from the working copy (pre-filter, all fields available).
    const computed = buildComputedBlock(working, now);

    // Step 9: Build relationships block from the working copy.
    const relationships = buildRelationshipsBlock(working);

    // Step 10: Assemble childCounts — omit zero-value keys (skipped when includeChildCounts=false)
    let childCounts: Record<string, unknown> | undefined;
    if (includeChildCounts) {
        childCounts = {};
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
    }

    // Step 11: Build _meta
    const countErrors = (childCountsInput._countErrors ?? []) as CountError[];

    const transformationsApplied: string[] = [];
    if (aliasMap) transformationsApplied.push('aliasExpansion');
    transformationsApplied.push('nullFiltering');
    if (truncatedFields.length > 0) transformationsApplied.push('textTruncation');
    transformationsApplied.push('typeAwareOrdering');

    const slaId = working.serviceLevelAgreementID;

    const meta: Record<string, unknown> = {
        // Identity
        source: 'ticket.summary',
        generatedAt: now.toISOString(),
        // Detection
        detectedTicketType: detectedType,
        typeDetectedBy: detection.detectedBy,
        // Options
        rawIncluded: includeRaw,
        summaryTextLimit,
        childCountsIncluded: includeChildCounts,
        // Transformations
        transformationsApplied,
        // Fields
        prioritisedFields,
        excludedFieldCount: excludedFieldNames.length,
        excludedFieldNames,
        // Alias state
        aliasesApplied: aliasMap !== null,
        // Truncation
        truncationApplied: truncatedFields.length > 0,
        // Counts
        countsPartial: includeChildCounts && countErrors.length > 0,
        slaDetailAvailable: slaId !== null && slaId !== undefined && slaId !== '',
    };

    if (suppressedCanonicalFields.length > 0) {
        meta.suppressedCanonicalFields = suppressedCanonicalFields;
        meta.aliasMap = metaAliasMap;
    }

    if (truncatedFields.length > 0) {
        meta.truncatedFields = truncatedFields;
    }

    if (countErrors.length > 0) {
        meta.countErrors = countErrors;
    }

    // Step 12: Assemble result
    const result: TicketSummaryResult = {
        summary,
        computed,
        _meta: meta,
    };

    if (relationships) {
        result.relationships = relationships;
    }

    if (childCounts !== undefined) {
        result.childCounts = childCounts;
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
    detectedType: TicketType,
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
