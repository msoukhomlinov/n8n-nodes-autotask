import type { TypedReferenceStrategy } from './types';

export const TYPED_REFERENCE_STRATEGIES: Record<string, TypedReferenceStrategy> = {
	ticket: {
		entityType: 'ticket',
		queryEndpoint: 'Tickets/query',
		numberField: 'ticketNumber',
		numberPattern: /^T\d{8}\.\d{4}$/,
		companionFieldName: 'ticketLookupField',
		searchableFields: ['title', 'description'],
		defaultSearchField: 'title',
		formatHint: 'T{YYYYMMDD}.{seq4}',
		exampleValue: 'T20240615.0674',
		formatCandidateDisplayName: (e) =>
			`${String(e.ticketNumber ?? '')} — ${String(e.title ?? '')}`.trim(),
	},
	project: {
		entityType: 'project',
		queryEndpoint: 'Projects/query',
		numberField: 'projectNumber',
		numberPattern: undefined, // tenant-configurable; non-numeric heuristic only
		companionFieldName: 'projectLookupField',
		searchableFields: ['projectName', 'description'],
		defaultSearchField: 'projectName',
		formatHint: 'tenant-configurable (e.g. P{YYYYMMDD}.{seq})',
		exampleValue: 'P20240615.0010',
		formatCandidateDisplayName: (e) =>
			`${String(e.projectNumber ?? '')} — ${String(e.projectName ?? '')}`.trim(),
	},
};

/** All companion field names emitted by registered strategies */
export const TYPED_REFERENCE_COMPANION_FIELDS = new Set(
	Object.values(TYPED_REFERENCE_STRATEGIES).map((s) => s.companionFieldName),
);
