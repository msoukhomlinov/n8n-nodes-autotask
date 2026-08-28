import { wrapError, ERROR_TYPES } from '../error-formatter';
import {
	buildListResponse,
	buildItemResponse,
	buildMutationResponse,
	buildNoChangeMutationResponse,
	buildDeleteResponse,
	buildCountResponse,
	buildSlaHealthCheckResponse,
	buildTicketSummaryResponse,
	toResolvedLabels,
	computeListContinuation,
	type ToolResponseContext,
	type ListPaginationState,
} from '../response-builder';
import { MAX_QUERY_LIMIT, getEffectiveLimit } from '../tool-executor';
import { getOperationMetadata } from '../operation-metadata';

export const MAX_RESPONSE_RECORDS = 500;

/**
 * Bounded-scan coverage (C1 fix, re-based by Codex P2, extended by B1):
 * searchByDomain/searchByIdentity run bounded FILTERED queries over the company
 * population and then slice a DERIVED candidate set (distinct companies / ranked
 * candidates) at `limit`. `windowComplete` reflects BOTH truncation sources —
 * true only when every filtered query returned below its cap AND the derived
 * candidate set was not sliced, so no matching record (raw rows or derived
 * candidates) was truncated away. `totalAvailable` is the tenant-wide company
 * count (informational context, NOT a denominator for completeness: comparing
 * matches against the tenant population reported almost every selective search
 * as partial). The producer (helpers/company-domain-search.ts) publishes
 * {scanned, totalAvailable?, windowComplete, truncationNote?}; this normaliser
 * validates the producer's flag instead of re-deriving it from
 * scanned-vs-totalAvailable, and passes the producer's `truncationNote` (which
 * stage truncated: derived candidate slice, or also-incomplete underlying scan
 * stages) through so the PARTIAL summary names the stage.
 */
interface SearchCoverage {
	scanned: number;
	totalAvailable?: number;
	windowComplete: boolean;
	truncationNote?: string;
}

function normalizeSearchCoverage(raw: unknown): SearchCoverage {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const c = raw as Record<string, unknown>;
		const scanned = typeof c.scanned === 'number' && Number.isFinite(c.scanned) ? c.scanned : 0;
		const totalAvailable =
			typeof c.totalAvailable === 'number' && Number.isFinite(c.totalAvailable)
				? c.totalAvailable
				: undefined;
		// Codex P2: trust the producer's flag (filtered-cap semantics, B1: derived
		// slice folded in by the producer). Re-deriving windowComplete as
		// scanned >= totalAvailable re-created the defect: one match below the cap
		// in a 10,000-company tenant read as partial coverage.
		const windowComplete = typeof c.windowComplete === 'boolean' ? c.windowComplete : false;
		const truncationNote =
			typeof c.truncationNote === 'string' && c.truncationNote.trim() !== ''
				? c.truncationNote
				: undefined;
		return {
			scanned,
			...(totalAvailable !== undefined ? { totalAvailable } : {}),
			windowComplete,
			...(truncationNote ? { truncationNote } : {}),
		};
	}
	return { scanned: 0, windowComplete: false };
}

function coverageRootFields(coverage: SearchCoverage): Record<string, unknown> {
	return {
		scanned: coverage.scanned,
		...(coverage.totalAvailable !== undefined ? { totalAvailable: coverage.totalAvailable } : {}),
		windowComplete: coverage.windowComplete,
		...(coverage.truncationNote ? { truncationNote: coverage.truncationNote } : {}),
	};
}

function boundedScanPlural(resource: string): string {
	// searchByDomain/searchByIdentity are company-only operations today; keep the
	// summary wording grammatical for both the singular resource key and any
	// future resource these dispatch cases might be extended to.
	return resource === 'company' ? 'companies' : `${resource}s`;
}

function boundedScanSummary(resource: string, found: number, coverage: SearchCoverage): string {
	if (coverage.windowComplete) {
		return (
			`Found ${found} ${resource} records — complete filtered set: every ${resource} matching the search ` +
			`was returned (filtered queries below their scan cap), no further calls needed.`
		);
	}
	// B1: when the producer names a stage, render THAT stage (derived candidate
	// slice). Only fall back to the raw-cap wording when no derived slice
	// truncated — then a bounded filtered query hitting its cap is the source.
	if (coverage.truncationNote) {
		return (
			`Found ${found} ${resource} records — PARTIAL coverage: ${coverage.truncationNote}; ` +
			`additional matching ${boundedScanPlural(resource)} may not be included.`
		);
	}
	// Codex P2: partial = a bounded filtered query hit its cap. `scanned` is the row
	// count those queries returned, and `totalAvailable` is the tenant-wide company
	// count — never phrase the two as one population.
	const total = coverage.totalAvailable !== undefined ? String(coverage.totalAvailable) : 'unknown';
	return (
		`Found ${found} ${resource} records — PARTIAL coverage: the bounded filtered scan hit its cap after ` +
		`${coverage.scanned} records (tenant total: ${total} ${boundedScanPlural(resource)}); ` +
		`additional matching ${boundedScanPlural(resource)} may not be included.`
	);
}

interface OperationResponseParams {
	id?: number;
	ticketNumber?: string;
	resourceID?: string | number;
	year?: string | number;
	limit?: number;
	returnAll?: boolean;
	filtersJson?: string;
	filter_field?: string;
	filter_op?: string;
	filter_value?: string | number | boolean | Array<string | number | boolean>;
	filter_field_2?: string;
	filter_op_2?: string;
	filter_value_2?: string | number | boolean | Array<string | number | boolean>;
	filter_logic?: 'and' | 'or';
	recency?: string;
	since?: string;
	until?: string;
}

interface MutationValidationResult {
	ok: boolean;
	id?: number | string;
	/** No-change mutation outcome (moveToCompany skip / dry run) — rendered as a compound-style envelope with NO top-level id. */
	outcome?: 'skipped' | 'dry-run';
	/** Root context fields for no-change outcomes (sourceContactId, destinationCompanyId, duplicateContactId, warnings). */
	noChangeContext?: Record<string, unknown>;
	/**
	 * F7b: root context fields for CHANGE outcomes (moveToCompany success) — mover
	 * warnings + auditNotes — so a successful move no longer swallows audit-note
	 * creation failures. Merged into the ToolResponseContext at envelope build time.
	 */
	mutationContext?: {
		resolutionWarnings?: string[];
		auditNotes?: { sourceCompanyNoteId: number; destinationCompanyNoteId: number };
	};
	errorType?: string;
	message?: string;
	hint?: string;
}

export function dispatchOperationResponse(
	resource: string,
	operation: string,
	records: Record<string, unknown>[],
	params: OperationResponseParams,
	context: ToolResponseContext = {},
): string {
	const firstRecord = records[0] ?? null;
	const responseKind = getOperationMetadata(operation)?.responseKind;

	const extractId = (record: Record<string, unknown> | null): number | string | null => {
		if (!record) return null;
		// autotaskApiRequest wraps POST/PUT/PATCH responses as { item: { id|itemId: N } }
		// (helpers/http/request.ts). Check the wrapped form first, then top-level as fallback.
		const inner = record.item;
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			const innerRecord = inner as Record<string, unknown>;
			const wrappedCandidate = innerRecord.itemId ?? innerRecord.id;
			if (typeof wrappedCandidate === 'number' || typeof wrappedCandidate === 'string') {
				return wrappedCandidate;
			}
		}
		const candidate = record.itemId ?? record.id;
		return typeof candidate === 'number' || typeof candidate === 'string' ? candidate : null;
	};
	const isEmptyObjectRecord = (record: Record<string, unknown> | null): boolean =>
		record !== null && !Array.isArray(record) && Object.keys(record).length === 0;

	const validateMutationSuccess = (
		op: string,
		record: Record<string, unknown> | null,
	): MutationValidationResult => {
		const recordId = extractId(record);
		switch (op) {
			case 'create': {
				if (recordId !== null) return { ok: true, id: recordId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `Create ${resource} did not return a created entity ID.`,
					hint: `Retry autotask_${resource} with operation 'create'. If it persists, inspect API response shape for ${resource}.create.`,
				};
			}
			case 'update': {
				const fallbackId = params.id;
				if (recordId !== null) return { ok: true, id: recordId };
				if (fallbackId !== undefined && fallbackId !== null) return { ok: true, id: fallbackId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `Update ${resource} succeeded but no target ID could be confirmed.`,
					hint: `Call autotask_${resource} with operation 'update' and include a numeric 'id'.`,
				};
			}
			case 'approve':
			case 'reject': {
				const fallbackId = params.id;
				if (recordId !== null) return { ok: true, id: recordId };
				if (isEmptyObjectRecord(record) || record?.success === true) {
					if (fallbackId !== undefined && fallbackId !== null) {
						return { ok: true, id: fallbackId };
					}
				}
				if (record === null || record === undefined) {
					return {
						ok: false,
						errorType: ERROR_TYPES.ENTITY_NOT_FOUND,
						message: `No ${resource} found with id ${fallbackId ?? 'unknown'}.`,
						hint: `Use autotask_${resource} with operation 'getMany' to locate a valid record, then retry ${op}.`,
					};
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `${op === 'approve' ? 'Approve' : 'Reject'} ${resource} returned an unverifiable success payload.`,
					hint: `Call autotask_${resource} with operation '${op}' and include a numeric 'id'.`,
				};
			}
			case 'moveToCompany': {
				const movedId = record?.newContactId;
				const hasMovedId = typeof movedId === 'number' && movedId > 0;
				const markedSuccess = record?.success === true;
				const isDryRun = record?.dryRun === true;
				const isSkipped = record?.skipped === true;
				// No-change outcomes are checked BEFORE newContactId: on a skip the
				// mover sets newContactId to the pre-existing duplicate contact ID
				// (or 0), so a movedId-first check would report the duplicate as if
				// the move had happened (top-level id + '…successfully').
				if (markedSuccess && isSkipped) {
					const noChangeContext: Record<string, unknown> = {};
					if (typeof record?.sourceContactId === 'number') {
						noChangeContext.sourceContactId = record.sourceContactId;
					}
					if (typeof record?.destinationCompanyId === 'number') {
						noChangeContext.destinationCompanyId = record.destinationCompanyId;
					}
					if (hasMovedId) {
						// duplicate contact that blocked the move — not a created record
						noChangeContext.duplicateContactId = movedId;
					}
					if (Array.isArray(record?.warnings) && (record.warnings as string[]).length > 0) {
						noChangeContext.warnings = record.warnings;
					}
					return { ok: true, outcome: 'skipped', noChangeContext };
				}
				if (markedSuccess && isDryRun && !hasMovedId) {
					const noChangeContext: Record<string, unknown> = {};
					if (typeof record?.sourceContactId === 'number') {
						noChangeContext.sourceContactId = record.sourceContactId;
					}
					if (typeof record?.destinationCompanyId === 'number') {
						noChangeContext.destinationCompanyId = record.destinationCompanyId;
					}
					if (Array.isArray(record?.warnings) && (record.warnings as string[]).length > 0) {
						noChangeContext.warnings = record.warnings;
					}
					return { ok: true, outcome: 'dry-run', noChangeContext };
				}
				if (hasMovedId) {
					const mutationContext: NonNullable<MutationValidationResult['mutationContext']> = {};
					if (Array.isArray(record?.warnings) && (record.warnings as string[]).length > 0) {
						mutationContext.resolutionWarnings = record.warnings as string[];
					}
					if (
						record?.auditNotes &&
						typeof record.auditNotes === 'object' &&
						!Array.isArray(record.auditNotes)
					) {
						const an = record.auditNotes as Record<string, unknown>;
						const srcNote = typeof an.sourceCompanyNoteId === 'number' ? an.sourceCompanyNoteId : 0;
						const dstNote = typeof an.destinationCompanyNoteId === 'number' ? an.destinationCompanyNoteId : 0;
						// Omit when no note was actually created (both 0): the envelope
						// convention only includes non-empty context fields. A REQUESTED
						// note that failed to create surfaces via resolutionWarnings
						// (the mover pushes the API error there), so nothing is lost.
						if (srcNote > 0 || dstNote > 0) {
							mutationContext.auditNotes = { sourceCompanyNoteId: srcNote, destinationCompanyNoteId: dstNote };
						}
					}
					return { ok: true, id: movedId, ...(Object.keys(mutationContext).length > 0 ? { mutationContext } : {}) };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `moveToCompany did not return 'newContactId'.`,
					hint: `Retry the move, then verify contact-mover output includes 'newContactId'.`,
				};
			}
			case 'moveConfigurationItem': {
				const movedId = record?.newConfigurationItemId;
				if (typeof movedId === 'number' && movedId > 0) return { ok: true, id: movedId };
				const runId = record?.runId;
				if (record?.dryRun === true && typeof runId === 'string' && runId.trim() !== '') {
					return { ok: true, id: runId };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `moveConfigurationItem did not return 'newConfigurationItemId'.`,
					hint: `Retry the move, then verify migration output includes 'newConfigurationItemId' (or runId for dry run).`,
				};
			}
			case 'transferOwnership': {
				const runId = record?.runId;
				const summaryCounts = record?.summaryCounts;
				if (typeof runId === 'string' && runId.trim() !== '' && summaryCounts !== undefined) {
					return { ok: true, id: runId };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `transferOwnership did not return expected run summary fields (runId, summaryCounts).`,
					hint: `Retry transferOwnership and inspect work-reassigner response integrity.`,
				};
			}
			default: {
				if (recordId !== null) return { ok: true, id: recordId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `${resource}.${op} returned an unsupported mutation response shape.`,
					hint: `Use a supported mutation operation for autotask_${resource}.`,
				};
			}
		}
	};

	if (responseKind === 'list' && !['searchByDomain', 'searchByIdentity'].includes(operation)) {
		const hasFilters = !!(
			params.filter_field ||
			params.filter_field_2 ||
			params.filtersJson ||
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
			if (params.filter_logic && params.filter_logic !== 'and') {
				filtersUsed.filter_logic = params.filter_logic;
			}
			if (params.filtersJson) filtersUsed.filtersJson = params.filtersJson;
			if (params.recency) filtersUsed.recency = params.recency;
			if (params.since) filtersUsed.since = params.since;
			if (params.until) filtersUsed.until = params.until;

			const usedFilterFields = new Set<string>(
				[
					typeof params.filter_field === 'string' ? params.filter_field : '',
					typeof params.filter_field_2 === 'string' ? params.filter_field_2 : '',
				]
					.map((f) => f.trim().toLowerCase())
					.filter((f) => f !== ''),
			);
			const alternativeFilterFields = (context.readFields ?? [])
				.filter(
					(f) =>
						!f.udf &&
						typeof f.type === 'string' &&
						f.type.toLowerCase() === 'string' &&
						!usedFilterFields.has(f.id.toLowerCase()),
				)
				.map((f) => f.id)
				.slice(0, 10);

			const contextFields: Record<string, unknown> = { filtersUsed };
			if (alternativeFilterFields.length > 0) {
				contextFields.alternativeFilterFields = alternativeFilterFields;
			}
			const unresolvedFilterWarnings = context.resolutionWarnings ?? [];
			if (unresolvedFilterWarnings.length > 0) {
				contextFields.filterResolutionWarnings = unresolvedFilterWarnings;
			}
			// Hint: string fields with eq op — partial name likely needs contains
			const stringEqFields: string[] = [];
			for (const [fieldKey, opKey] of [
				['filter_field', 'filter_op'],
				['filter_field_2', 'filter_op_2'],
			] as const) {
				const field = typeof params[fieldKey] === 'string' ? (params[fieldKey] as string).trim() : '';
				const op = typeof params[opKey] === 'string' ? (params[opKey] as string).toLowerCase() : 'eq';
				const val = params[fieldKey === 'filter_field' ? 'filter_value' : 'filter_value_2'];
				if (!field || typeof val !== 'string' || (op !== 'eq' && op !== 'equals')) continue;
				const fieldMeta = (context.readFields ?? []).find(
					(f) => f.id.toLowerCase() === field.toLowerCase(),
				);
				if (fieldMeta && fieldMeta.type.toLowerCase() === 'string') {
					stringEqFields.push(field);
				}
			}
			if (stringEqFields.length > 0) {
				contextFields.containsHint = `${stringEqFields.map((f) => `'${f}'`).join(', ')} ${stringEqFields.length === 1 ? 'is a string field' : 'are string fields'} — if the value is a partial name, retry with filter_op='contains' for a substring match.`;
			}
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					ERROR_TYPES.NO_RESULTS_FOUND,
					`No ${resource} records matched the supplied filters.`,
					`Definitive negative — do not retry with the same filters. Broaden or change filter_field/filter_value and retry autotask_${resource} with operation 'getMany' (or a different operation).`,
					contextFields,
				),
			);
		}

		const total = records.length;
		const effectiveCap = context.clientCap ?? MAX_RESPONSE_RECORDS;
		const truncated = total > effectiveCap;
		const items = truncated ? records.slice(0, effectiveCap) : records;
		const currentOffset = context.effectiveOffset ?? 0;
		let totalAvailable: number | undefined;
		const continuationContract = computeListContinuation({
			currentOffset,
			recordsReturned: items.length,
			recordsMatched: total,
			requestedLimit: getEffectiveLimit(params.limit),
			returnAll: context.wasReturnAll === true,
			recencyActive: context.recencyActive === true,
			maxQueryLimit: MAX_QUERY_LIMIT,
			serverCap: context.serverCap ?? MAX_QUERY_LIMIT,
			clientCap: context.clientCap ?? MAX_RESPONSE_RECORDS,
			serverCapReached:
				context.serverCapReached === true || context.recencyWindowLimited === true,
		});
		const hasMore = continuationContract.continuation?.hasMore === true;
		const nextOffset = continuationContract.continuation?.nextOffset;

		if (truncated) totalAvailable = total;

		// Count-injection override: executor-supplied total takes precedence over fetched-count heuristic.
		// When the sequential/parallel count query succeeded, its result is the authoritative totalAvailable.
		const injectedTotal = (context as ToolResponseContext & { injectedTotalAvailable?: number }).injectedTotalAvailable;
		if (injectedTotal !== undefined) {
			totalAvailable = injectedTotal;
		}

		const notes: string[] = [];
		if (context.recencyNote) notes.push(context.recencyNote);
		if (continuationContract.truncationReason) {
			notes.push(continuationContract.truncationReason);
		}

		const listWarnings: string[] = [...(context.resolutionWarnings ?? [])];
		if (context.recencyWindowLimited) {
			listWarnings.push(
				'500 records were returned for the current recency window. Narrow recency, or provide since/until, to ensure the newest records are included.',
			);
		}

		const pagination: ListPaginationState = {
			hasMore,
			...(nextOffset !== undefined ? { nextOffset } : {}),
			...(totalAvailable !== undefined ? { totalAvailable } : {}),
			...(notes.length > 0 ? { notes } : {}),
			continuation: continuationContract.continuation,
			isTruncated: continuationContract.isTruncated,
			truncationReason: continuationContract.truncationReason,
			serverCap: continuationContract.serverCap,
			clientCap: continuationContract.clientCap,
		};

		const listContext: ToolResponseContext = {
			...context,
			resolutionWarnings: listWarnings,
		};

		return JSON.stringify(buildListResponse(resource, operation, items, pagination, listContext));
	}

	if (responseKind === 'mutation') {
		const validation = validateMutationSuccess(operation, firstRecord);
		if (!validation.ok) {
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					validation.errorType ?? ERROR_TYPES.API_ERROR,
					validation.message ?? `${resource}.${operation} failed validation.`,
					validation.hint ?? `Retry autotask_${resource} with operation '${operation}'.`,
				),
			);
		}

		// No-change mutation outcomes (moveToCompany skip / dry run): compound-style
		// envelope with top-level `outcome` and NO top-level `id` — a skip must not
		// render as a successful move (F-C).
		if (validation.outcome === 'skipped' || validation.outcome === 'dry-run') {
			return JSON.stringify(
				buildNoChangeMutationResponse(resource, operation, validation.outcome, validation.noChangeContext, context),
			);
		}

		// Unwrap the { item: { id: N } } envelope produced by autotaskApiRequest so
		// response.record contains entity fields directly, not nested under .item.
		const mutationRecord =
			firstRecord !== null &&
			typeof firstRecord === 'object' &&
			!Array.isArray(firstRecord) &&
			firstRecord.item !== null &&
			typeof firstRecord.item === 'object' &&
			!Array.isArray(firstRecord.item)
				? (firstRecord.item as Record<string, unknown>)
				: firstRecord ?? undefined;

		// F7b: hoist mover warnings/auditNotes (mutationContext) into the envelope context so
		// a successful move surfaces audit-note failures instead of swallowing them.
		const mergedContext: ToolResponseContext = validation.mutationContext
			? {
					...context,
					auditNotes: validation.mutationContext.auditNotes,
					resolutionWarnings: validation.mutationContext.resolutionWarnings
						? [...(context.resolutionWarnings ?? []), ...validation.mutationContext.resolutionWarnings]
						: context.resolutionWarnings,
				}
			: context;
		return JSON.stringify(
			buildMutationResponse(resource, operation, validation.id ?? 'unknown', mutationRecord, mergedContext),
		);
	}

	switch (operation) {
		case 'get': {
			if (
				firstRecord === null ||
				(typeof firstRecord === 'object' &&
					!Array.isArray(firstRecord) &&
					Object.keys(firstRecord).length === 0)
			) {
				const id = params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${id}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildItemResponse(resource, operation, firstRecord, {}, context));
		}

		case 'whoAmI': {
			if (firstRecord === null || firstRecord === undefined) {
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found for authenticated user.`,
						`Use autotask_${resource} with operation 'getMany' to locate a valid record, then retry.`,
					),
				);
			}
			return JSON.stringify(
				buildItemResponse(resource, operation, firstRecord, { verb: 'Authenticated as' }, context),
			);
		}

		case 'searchByDomain': {
			// The companies handler pushes the full search ENVELOPE as a single object
			// (returnData.push({ json: response })), so `records` is always [<envelope>]
			// — records.length === 1 even on a genuine no-match. Inspect the envelope's
			// `source`/`results` to distinguish a real match from a no-match. The actual
			// company rows live in envelope.results (CompanyDomainResultItem[]).
			const envelope = (records[0] ?? null) as Record<string, unknown> | null;
			const envelopeResults = Array.isArray(envelope?.results)
				? (envelope?.results as Record<string, unknown>[])
				: [];
			const isNoMatch = envelope?.source === 'none' || envelopeResults.length === 0;
			// C1 fix: the scan is a bounded window over the company population.
			const coverage = normalizeSearchCoverage(envelope?.coverage);

			if (isNoMatch) {
				const unresolvedSearch =
					envelope && typeof envelope.unresolvedSearch === 'object' && envelope.unresolvedSearch !== null
						? (envelope.unresolvedSearch as Record<string, unknown>)
						: undefined;
				const directive =
					typeof unresolvedSearch?.nextAction === 'string' && unresolvedSearch.nextAction.trim() !== ''
						? (unresolvedSearch.nextAction as string)
						: `Verify the domain and retry, or use autotask_${resource} with operation 'getMany' with a filter.`;
				const notes = Array.isArray(envelope?.notes)
					? (envelope?.notes as unknown[]).filter((note): note is string => typeof note === 'string')
					: [];
				// A bounded no-match must not read as "definitely no company has this
				// domain" — the coverage context makes the scan window explicit.
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.NO_RESULTS_FOUND,
						`No ${resource} found matching the supplied domain within the scanned window.`,
						directive,
						{ ...(notes.length > 0 ? { notes } : {}), ...coverageRootFields(coverage) },
					),
				);
			}

			// Real match — unwrap the envelope's results into the list response so the model
			// sees the actual company rows and an accurate count, not "Found 1 records".
			const matchedRecords = envelopeResults;
			// searchByDomain uses list shape — no domain-specific qualifier in summary since params.domain is not passed
			const resolvedLabels = toResolvedLabels(context.resolutions);
			return JSON.stringify({
				summary: boundedScanSummary(resource, matchedRecords.length, coverage),
				resource,
				operation: `${resource}.${operation}`,
				records: matchedRecords,
				returnedCount: matchedRecords.length,
				// B1: hasMore is TRUE whenever the producer reports truncation — either
				// raw scan cap or the derived candidate slice — so a withheld lower-ranked
				// match can never read as "no more results".
				hasMore: !coverage.windowComplete,
				continuation: null,
				isTruncated: !coverage.windowComplete,
				truncationReason: coverage.windowComplete
					? null
					: coverage.truncationNote
						? 'derived-candidate-cap'
						: 'bounded-scan',
				serverCap: MAX_QUERY_LIMIT,
				clientCap: MAX_RESPONSE_RECORDS,
				resolvedLabels,
				pendingConfirmations: context.pendingConfirmations ?? [],
				warnings: context.resolutionWarnings ?? [],
				...coverageRootFields(coverage),
			});
		}

		case 'searchByIdentity': {
			// The companies handler pushes the identity search ENVELOPE as a single
			// object (CompanyIdentitySearchResult); records[0] carries `source`,
			// `results` (the ranked candidates) and the bounded-scan `coverage` (C1 fix).
			const envelope = (records[0] ?? null) as Record<string, unknown> | null;
			const isEnvelope =
				envelope !== null && envelope !== undefined && typeof envelope.source === 'string';
			if (isEnvelope) {
				const envelopeResults = Array.isArray(envelope?.results)
					? (envelope?.results as Record<string, unknown>[])
					: [];
				const isNoMatch = envelope?.source === 'none' || envelopeResults.length === 0;
				const coverage = normalizeSearchCoverage(envelope?.coverage);
				if (isNoMatch) {
					// A bounded no-match must not read as "definitely no company
					// matches these signals" — the coverage context makes the scan
					// window explicit.
					return JSON.stringify(
						wrapError(
							resource,
							operation,
							ERROR_TYPES.NO_RESULTS_FOUND,
							`No ${resource} found matching the supplied identity signals within the scanned window.`,
							`Retry with additional hints (companyName, email, website), or use autotask_${resource} with operation 'getMany' with a filter.`,
							coverageRootFields(coverage),
						),
					);
				}
				const resolvedLabels = toResolvedLabels(context.resolutions);
				const partialTotal = coverage.totalAvailable !== undefined ? String(coverage.totalAvailable) : 'unknown';
				// Codex P2: partial = a bounded filtered query hit its cap; scanned is
				// the rows those queries returned, totalAvailable the tenant-wide count.
				// Round-4 N1: unwrap the envelope's results like the searchByDomain
				// sibling — records[0] is the search ENVELOPE, so counting
				// records.length reported "Found 1 ranked … candidates" (returnedCount
				// 1) while the actual candidates (N) sat in records[0].results.
				// records/returnedCount/summary now reflect the real candidate set.
				const matchedRecords = envelopeResults;
				// B1: when the producer names a truncating stage (derived candidate
				//slice), render THAT stage; otherwise the raw-cap wording applies.
				const partialReason = coverage.truncationNote
					? coverage.truncationNote
					: `the bounded filtered scan hit its cap after ${coverage.scanned} records (tenant total: ${partialTotal} ${boundedScanPlural(resource)})`;
				const summary = coverage.windowComplete
					? `Found ${matchedRecords.length} ranked ${resource} candidates — complete filtered set (filtered queries below their scan cap), no further calls needed.`
					: `Found ${matchedRecords.length} ranked ${resource} candidates — PARTIAL coverage: ${partialReason}; additional matching ${boundedScanPlural(resource)} may not be included.`;
				return JSON.stringify({
					summary,
					resource,
					operation: `${resource}.${operation}`,
					records: matchedRecords,
					returnedCount: matchedRecords.length,
					// B1: truthful hasMore for ANY truncation source (raw cap or derived
					// candidate slice) — see the searchByDomain sibling.
					hasMore: !coverage.windowComplete,
					continuation: null,
					isTruncated: !coverage.windowComplete,
					truncationReason: coverage.windowComplete
						? null
						: coverage.truncationNote
							? 'derived-candidate-cap'
							: 'bounded-scan',
					serverCap: MAX_QUERY_LIMIT,
					clientCap: MAX_RESPONSE_RECORDS,
					resolvedLabels,
					pendingConfirmations: context.pendingConfirmations ?? [],
					warnings: context.resolutionWarnings ?? [],
					...coverageRootFields(coverage),
				});
			}
			// Defensive fallback: non-envelope records. No current producer takes
			// this path — the companies handler always pushes the search envelope.
			if (records.length === 0) {
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.NO_RESULTS_FOUND,
						`No ${resource} found matching the supplied identity signals.`,
						`Retry with additional hints (companyName, email, website), or use autotask_${resource} with operation 'getMany' with a filter.`,
					),
				);
			}
			const resolvedLabels = toResolvedLabels(context.resolutions);
			return JSON.stringify({
				summary: `Found ${records.length} ranked ${resource} candidates — complete set, no further calls needed.`,
				resource,
				operation: `${resource}.${operation}`,
				records,
				returnedCount: records.length,
				hasMore: false,
				continuation: null,
				isTruncated: false,
				truncationReason: null,
				serverCap: MAX_QUERY_LIMIT,
				clientCap: MAX_RESPONSE_RECORDS,
				resolvedLabels,
				pendingConfirmations: context.pendingConfirmations ?? [],
				warnings: context.resolutionWarnings ?? [],
			});
		}

		case 'slaHealthCheck': {
			if (firstRecord === null || firstRecord === undefined) {
				const identifier = params.ticketNumber ?? params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${identifier}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildSlaHealthCheckResponse(resource, operation, firstRecord, context));
		}

		case 'summary': {
			if (firstRecord === null || firstRecord === undefined) {
				const identifier = params.ticketNumber ?? params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${identifier}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildTicketSummaryResponse(resource, operation, firstRecord, context));
		}

		case 'delete': {
			const id = params.id ?? extractId(firstRecord) ?? 'unknown';
			return JSON.stringify(buildDeleteResponse(resource, operation, id, context));
		}

		case 'count': {
			const countValue = records[0]?.count ?? records.length;
			return JSON.stringify(buildCountResponse(resource, operation, countValue as number));
		}

		case 'getByResource':
		case 'getByYear': {
			const entity = firstRecord;
			if (
				entity === null ||
				entity === undefined ||
				(typeof entity === 'object' &&
					!Array.isArray(entity) &&
					Object.keys(entity as object).length === 0)
			) {
				if (operation === 'getByYear') {
					const rid = params.resourceID ?? 'unknown';
					const yr = params.year ?? 'unknown';
					return JSON.stringify(
						wrapError(
							resource,
							operation,
							ERROR_TYPES.ENTITY_NOT_FOUND,
							`No ${resource} found for resource ${rid}, year ${yr}.`,
							`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
						),
					);
				}
				const rid = params.resourceID ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found for resource ${rid}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildItemResponse(resource, operation, entity, {}, context));
		}

		default:
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					ERROR_TYPES.INVALID_OPERATION,
					`Unknown operation '${operation}'.`,
					`Use a supported operation for autotask_${resource}.`,
				),
			);
	}
}
