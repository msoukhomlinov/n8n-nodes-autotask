import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TicketTimelineOptions {
    ticketId: number;
    since?: string;
    until?: string;
    resourceId?: number;        // already resolved to numeric ID by caller
    includeHistories?: boolean; // default false
    textLimit?: number;         // default 500; 0 = no limit
    limit?: number;             // per-entity cap; default 50
}

export interface TimelineEvent {
    type: 'note' | 'timeEntry' | 'history';
    dateTime: string;
    id: number;
    [key: string]: unknown;
}

export interface TicketTimelineResult {
    events: TimelineEvent[];
    noteCount: number;
    timeEntryCount: number;
    historyCount: number;
    hasMore: boolean;
    stageWarnings: string[];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildTicketTimeline(
    context: IExecuteFunctions,
    options: TicketTimelineOptions,
): Promise<TicketTimelineResult> {
    const {
        ticketId,
        since,
        until,
        resourceId,
        includeHistories = false,
        textLimit = 500,
        limit = 50,
    } = options;

    function maybeTruncate(value: unknown): unknown {
        if (typeof value !== 'string') return value;
        if (textLimit <= 0 || value.length <= textLimit) return value;
        const originalLength = value.length;
        return `${value.slice(0, textLimit)}…[truncated, ${originalLength} chars total]`;
    }

    // Build date filter pairs for a given date field
    function buildDateFilters(dateField: string): Array<{ field: string; op: string; value: string }> {
        const filters: Array<{ field: string; op: string; value: string }> = [];
        if (since) filters.push({ field: dateField, op: 'gte', value: since });
        if (until) filters.push({ field: dateField, op: 'lte', value: until });
        return filters;
    }

    // Fetch TicketNotes
    const notesFilters: Array<{ field: string; op: string; value: unknown }> = [
        { field: 'ticketID', op: 'eq', value: ticketId },
        ...buildDateFilters('createDateTime'),
    ];
    if (resourceId != null) notesFilters.push({ field: 'creatorResourceID', op: 'eq', value: resourceId });

    // Fetch TimeEntries
    const teFilters: Array<{ field: string; op: string; value: unknown }> = [
        { field: 'ticketID', op: 'eq', value: ticketId },
        ...buildDateFilters('dateWorked'),
    ];
    if (resourceId != null) teFilters.push({ field: 'resourceID', op: 'eq', value: resourceId });

    // Fetch TicketHistories (optional)
    const histFilters: Array<{ field: string; op: string; value: unknown }> = [
        { field: 'ticketID', op: 'eq', value: ticketId },
        ...buildDateFilters('date'),
    ];
    if (resourceId != null) histFilters.push({ field: 'resourceID', op: 'eq', value: resourceId });

    const notesRequest = autotaskApiRequest.call(
        context,
        'POST',
        'TicketNotes/query',
        { filter: notesFilters, MaxRecords: limit } as unknown as IDataObject,
    );

    const teRequest = autotaskApiRequest.call(
        context,
        'POST',
        'TimeEntries/query',
        { filter: teFilters, MaxRecords: limit } as unknown as IDataObject,
    );

    const histRequest = includeHistories
        ? autotaskApiRequest.call(
            context,
            'POST',
            'TicketHistory/query',
            { filter: histFilters, MaxRecords: limit } as unknown as IDataObject,
          )
        : Promise.resolve({ items: [] as unknown[] });

    const [notesResult, teResult, histResult] = await Promise.allSettled([
        notesRequest,
        teRequest,
        histRequest,
    ]);

    const stageWarnings: string[] = [];
    const events: TimelineEvent[] = [];

    // Process notes
    let noteCount = 0;
    if (notesResult.status === 'fulfilled') {
        const notes = ((notesResult.value as { items?: unknown[] })?.items) ?? [];
        noteCount = notes.length;
        for (const raw of notes) {
            const n = raw as Record<string, unknown>;
            events.push({
                type: 'note',
                dateTime: (n['createDateTime'] as string) ?? '',
                id: n['id'] as number,
                title: n['title'],
                description: maybeTruncate(n['description']),
                noteType: n['noteType'],
                creatorResourceID: n['creatorResourceID'],
                createdByContactID: n['createdByContactID'],
            });
        }
    } else {
        const msg = notesResult.reason instanceof Error ? notesResult.reason.message : String(notesResult.reason);
        stageWarnings.push(`TicketNote query failed: ${msg} — notes omitted from timeline`);
    }

    // Process time entries
    let timeEntryCount = 0;
    if (teResult.status === 'fulfilled') {
        const entries = ((teResult.value as { items?: unknown[] })?.items) ?? [];
        timeEntryCount = entries.length;
        for (const raw of entries) {
            const e = raw as Record<string, unknown>;
            events.push({
                type: 'timeEntry',
                dateTime: e['dateWorked'] ? `${e['dateWorked'] as string}T00:00:00Z` : '',
                id: e['id'] as number,
                hoursWorked: e['hoursWorked'],
                hoursToBill: e['hoursToBill'],
                summaryNotes: maybeTruncate(e['summaryNotes']),
                internalNotes: maybeTruncate(e['internalNotes']),
                resourceID: e['resourceID'],
                billingCodeID: e['billingCodeID'],
                isNonBillable: e['isNonBillable'],
            });
        }
    } else {
        const msg = teResult.reason instanceof Error ? teResult.reason.message : String(teResult.reason);
        stageWarnings.push(`TimeEntry query failed: ${msg} — time entries omitted from timeline`);
    }

    // Process histories
    let historyCount = 0;
    if (histResult.status === 'fulfilled') {
        const histories = ((histResult.value as { items?: unknown[] })?.items) ?? [];
        historyCount = histories.length;
        for (const raw of histories) {
            const h = raw as Record<string, unknown>;
            events.push({
                type: 'history',
                dateTime: (h['date'] as string) ?? '',
                id: h['id'] as number,
                action: h['action'],
                detail: h['detail'],
                resourceID: h['resourceID'],
            });
        }
    } else if (includeHistories) {
        const msg = histResult.reason instanceof Error ? histResult.reason.message : String(histResult.reason);
        stageWarnings.push(`TicketHistory query failed: ${msg} — history events omitted from timeline`);
    }

    // Sort chronologically (oldest-first)
    events.sort((a, b) => {
        const da = (a['dateTime'] as string) ?? '';
        const db = (b['dateTime'] as string) ?? '';
        return da < db ? -1 : da > db ? 1 : 0;
    });

    const hasMore = noteCount === limit || timeEntryCount === limit || (includeHistories && historyCount === limit);

    return { events, noteCount, timeEntryCount, historyCount, hasMore, stageWarnings };
}
