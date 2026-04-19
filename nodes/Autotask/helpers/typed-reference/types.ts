import type { IDataObject } from 'n8n-workflow';

export interface TypedReferenceStrategy {
	/** Entity type key — same as the TYPED_REFERENCE_STRATEGIES registry key (lowercase, e.g. 'ticket', 'project').
	 *  Included in the value object for self-describing error messages; must match `referencesEntity` values from describeResource(). */
	entityType: string;
	/** Autotask REST endpoint for queries — e.g. 'Tickets/query' */
	queryEndpoint: string;
	/** API field name for the human-visible number — e.g. 'ticketNumber', 'projectNumber' */
	numberField: string;
	/** Regex for unambiguous typed-id detection. Undefined = non-numeric heuristic only. */
	numberPattern?: RegExp;
	/** Top-level Zod schema field name for the search companion — e.g. 'ticketLookupField' */
	companionFieldName: string;
	/** Valid values for the companion enum field — must be non-empty (enforced by tuple type) */
	searchableFields: [string, ...string[]];
	/** Fallback search field when companion not supplied. When undefined, miss on no numberField match. */
	defaultSearchField?: string;
	/** Format description for LLM-facing schema hints */
	formatHint: string;
	/** Concrete example for LLM-facing descriptions */
	exampleValue: string;
	/** Build a human-readable display name for pendingConfirmations candidates */
	formatCandidateDisplayName(entity: IDataObject): string;
}

export type TypedResolutionOutcome =
	| { status: 'resolved'; id: string | number; method: 'number-exact' | 'search-unique' }
	| { status: 'pending'; candidates: Array<{ id: string | number; displayName: string }> }
	| { status: 'miss'; warning: string }
	| { status: 'skip' };
