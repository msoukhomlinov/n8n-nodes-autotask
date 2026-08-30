import { getEntityMetadata, entityNameForResource } from '../constants/entities';
import { getResourceOperations } from '../constants/resource-operations';
import { isWriteOperation } from './operation-metadata';

// ---------------------------------------------------------------------------
// Error type constants
// ---------------------------------------------------------------------------

export const ERROR_TYPES = {
	API_ERROR: 'API_ERROR',
	ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
	NO_RESULTS_FOUND: 'NO_RESULTS_FOUND',
	MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
	MISSING_ENTITY_ID: 'MISSING_ENTITY_ID',
	INVALID_OPERATION: 'INVALID_OPERATION',
	WRITE_OPERATION_BLOCKED: 'WRITE_OPERATION_BLOCKED',
	PERMISSION_DENIED: 'PERMISSION_DENIED',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
	INVALID_PICKLIST_VALUE: 'INVALID_PICKLIST_VALUE',
	INVALID_FIELDS: 'INVALID_FIELDS',
	INVALID_WRITE_FIELDS: 'INVALID_WRITE_FIELDS',
	INVALID_FILTER_CONSTRAINT: 'INVALID_FILTER_CONSTRAINT',
	INVALID_DEDUP_FIELD: 'INVALID_DEDUP_FIELD',
	DUPLICATE_RECORD: 'DUPLICATE_RECORD',
	MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
	WRITE_RESOLUTION_INCOMPLETE: 'WRITE_RESOLUTION_INCOMPLETE',
	INVALID_INPUT: 'INVALID_INPUT',
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	RATE_LIMITED: 'RATE_LIMITED',
} as const;

// ---------------------------------------------------------------------------
// Flat Response Standard (v2)
// ---------------------------------------------------------------------------

export interface FlatErrorResponse {
	nextAction: string;
	actionRequired?: boolean;
	error: true;
	errorType: string;
	resource: string;
	operation: string;
	summary: string;
	mustRetryAfter?: string[];
	retryAfterSeconds?: number;
	correlationId?: string;
}

/**
 * Build a flat error response. Context fields (filtersUsed, missingFields, etc.)
 * are spread at root level — no nesting under a generic `context` key.
 *
 * @warning contextFields keys must not collide with declared root fields
 * (error, errorType, resource, operation, summary, nextAction, correlationId).
 * Colliding keys will silently overwrite the declared values at runtime.
 */
const ACTIONABLE_PREFIX_TYPES = new Set<string>([
	ERROR_TYPES.INVALID_PICKLIST_VALUE,
	ERROR_TYPES.INVALID_FIELDS,
	ERROR_TYPES.INVALID_WRITE_FIELDS,
	ERROR_TYPES.MISSING_REQUIRED_FIELDS,
	ERROR_TYPES.ENTITY_NOT_FOUND,
	ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
	ERROR_TYPES.INVALID_DEDUP_FIELD,
	ERROR_TYPES.DUPLICATE_RECORD,
]);

export function wrapError(
	resource: string,
	operation: string,
	errorType: string,
	summary: string,
	nextAction: string,
	contextFields?: Record<string, unknown>,
	mustRetryAfter?: string[],
): FlatErrorResponse {
	const isActionable = Boolean(nextAction) && ACTIONABLE_PREFIX_TYPES.has(errorType);
	const finalSummary = isActionable
		? `REQUIRED NEXT STEP: ${nextAction} — ${summary}`
		: summary;

	return {
		nextAction,
		...(isActionable ? { actionRequired: true } : {}),
		error: true,
		errorType,
		resource,
		operation: `${resource}.${operation}`,
		summary: finalSummary,
		...(mustRetryAfter && mustRetryAfter.length > 0 ? { mustRetryAfter } : {}),
		...(contextFields ?? {}),
	} as FlatErrorResponse;
}

// ---------------------------------------------------------------------------
// Thin wrappers (preserve existing call-site signatures)
// ---------------------------------------------------------------------------

export function formatFieldError(
	errorType: 'INVALID_FIELDS' | 'INVALID_WRITE_FIELDS',
	resource: string,
	operation: string,
	invalidFields: string[],
	validFieldsSample: string[],
): FlatErrorResponse {
	const mode = errorType === 'INVALID_FIELDS' ? 'read' : 'write';
	return wrapError(
		resource,
		operation,
		errorType,
		`Invalid field name(s) for ${resource}.${operation}: ${invalidFields.join(', ')}`,
		`Call autotask_${resource} with operation 'describeFields' with mode '${mode}', then retry with valid field names.`,
		{ invalidFields, validFieldsSample },
		['describeFields'],
	);
}

export function formatRequiredFieldsError(
	resource: string,
	operation: string,
	missingFields: string[],
): FlatErrorResponse {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.MISSING_REQUIRED_FIELDS,
		`Missing required field(s) for ${resource}.${operation}: ${missingFields.join(', ')}`,
		`Call autotask_${resource} with operation 'describeFields' with mode 'write' to review required fields, then retry.`,
		{ missingFields },
		['describeFields'],
	);
}

export function formatIdError(resource: string, operation: string): FlatErrorResponse {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.MISSING_ENTITY_ID,
		`A numeric entity ID is required for ${resource}.${operation}.`,
		`Provide a numeric ID. If unknown, call autotask_${resource} with operation 'getMany' to locate the correct record first.`,
	);
}

export function formatFilterConstraintError(
	resource: string,
	operation: string,
	message: string,
	nextAction: string,
): FlatErrorResponse {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
		message,
		nextAction,
	);
}

export function formatRateLimitError(
	resource: string,
	operation: string,
	retryAfterSeconds?: number,
): FlatErrorResponse {
	// Sanitise: only propagate a finite positive integer; 0/negative/NaN would instruct "retry immediately"
	const safeSeconds = Number.isFinite(retryAfterSeconds) && (retryAfterSeconds as number) > 0
		? retryAfterSeconds
		: undefined;
	const waitHint = safeSeconds !== undefined ? ` Retry after ${safeSeconds}s.` : '';
	const base = wrapError(
		resource,
		operation,
		ERROR_TYPES.RATE_LIMITED,
		`Autotask API rate limit hit.${waitHint}`,
		'Stop retrying. Tell the user the Autotask API rate limit has been reached. Ask them to reduce workflow frequency or wait before retrying.',
	);
	if (safeSeconds !== undefined) {
		return { ...base, retryAfterSeconds: safeSeconds };
	}
	return base;
}

/**
 * v2.29.x (B2): query-control tokens that can leak into the field set of a
 * write/query request (e.g. "Unable to find limit in the <Entity> Entity").
 * Those are parameter-set leaks, not phantom FILTER fields — the phantom
 * branch in formatApiError must not classify them as such.
 */
const PHANTOM_FIELD_CONTROL_TOKENS = new Set(['limit', 'maxrecords', 'includefields', 'orderby']);

export function formatApiError(
	message: string,
	resource: string,
	operation: string,
): FlatErrorResponse {
	const lowerMessage = message.toLowerCase();

	if (
		lowerMessage.includes('rate limit')
		|| lowerMessage.includes('too many requests')
	) {
		// Only extract retry hint from genuine "retry after N seconds" phrasing.
		// Excludes "over N seconds" (elapsed time in handler exhaustion messages).
		const secondsMatch = message.match(/retry.{1,20}?(\d+)\s*s(?:ec|econds?)?/i);
		const retryAfterSeconds = secondsMatch ? Number.parseInt(secondsMatch[1], 10) : undefined;
		return formatRateLimitError(resource, operation, retryAfterSeconds);
	}

	// E1 fix — not-found must win over permission. Autotask tags error bodies with
	// [NotFoundError] / [NotFound] / [NotExists*] and the same message can hedge
	// with a "permission" phrase (e.g. the sandbox's
	// "[NotFoundError] The contacts with ID 999999999 was not found. Please verify
	// the ID is correct and that you have permission to access this record."),
	// which the permission branch used to classify as PERMISSION_DENIED with a
	// misleading recovery path. The deterministic tag is checked first.
	if (/\[(NotFoundError|NotFound|NotExists\w*)\]/i.test(message)) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.ENTITY_NOT_FOUND,
			message,
			`Use autotask_${resource} with operation 'getMany' and a filter to locate a valid record ID, then retry.`,
		);
	}

	// v2.29.0 (X3b): the API rejects duplicate creates with "Duplicate <Entity> found
	// (ID: X) ..." when the pre-dispatch dedup scan misses the record (concurrency or
	// dedup-field mismatch). Classify as DUPLICATE_RECORD with a concrete recovery
	// instead of the generic API_ERROR retry loop. The entity phrase may be
	// multi-word ('time entry', 'expense item') — the lazy capture stops at the
	// first 'found'; the optional ID group is unchanged.
	const duplicateMatch = message.match(/duplicate\s+(\w[\w ]*?)\s+found(\s+\(ID: ([\d]+)\))?/i);
	if (duplicateMatch) {
		const entityId = duplicateMatch[3] ?? undefined;
		const idHint = entityId ? `, or update record ${entityId} directly` : '';
		// errorOnDuplicate is only consumed by the createIfNotExists compound operation —
		// a plain 'create' ignores/strips it, so directing the model there just makes it
		// repeat the identical failing request. createIfNotExists reuses an existing
		// duplicate WITHOUT changing it (outcome: 'skipped') and CAN reconcile it when
		// updateFields are supplied and differ (outcome: 'updated'); 'found' is never
		// an emitted outcome. Recommend it only when the resource actually offers the
		// operation; other resources get a locate-then-cleanup recovery (Codex P2 + B1
		// on PR #148; x4 P2: corrected the 'found'/never-updates recovery contract).
		const supportsCreateIfNotExists = getResourceOperations(resource).includes('createIfNotExists');
		const nextAction = supportsCreateIfNotExists
			? (operation === 'create'
				? `Do not repeat the same create. Switch to operation 'createIfNotExists' on autotask_${resource} with dedupFields covering the identifying field(s) and errorOnDuplicate=false — an existing duplicate is reused without changes (outcome: 'skipped'); supplying updateFields reconciles fields that differ on the duplicate (outcome: 'updated')${idHint}.`
				: `Do not repeat the same call. Retry autotask_${resource} with operation 'createIfNotExists' and errorOnDuplicate=false — an existing duplicate is reused without changes (outcome: 'skipped'); supplying updateFields updates the fields that differ on the duplicate (outcome: 'updated')${idHint}.`)
			: `Locate the duplicate with autotask_${resource} operation 'getMany' filtered on the identifying fields, then update or delete the new record${entityId ? ` (id ${entityId})` : ''}.`;
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.DUPLICATE_RECORD,
			`Duplicate ${duplicateMatch[1].trim()} found${entityId ? ` (ID: ${entityId})` : ''} — a record with the same identifying values already exists.`,
			nextAction,
			entityId ? { duplicateId: Number(entityId) } : undefined,
		);
	}

	// v2.29.0 (X1): phantom filter field — advertised by describeFields (it exists in the
	// entity's field metadata) but rejected by the Autotask QUERY engine ("Unable to find
	// X in the <Entity> Entity."). E.g. ConfigurationItem 'Manufacturer' / UDF filter
	// values. The generic API_ERROR recovery ('call describeFields first and retry') loops
	// forever because describeFields re-advertises the phantom field — classify with a
	// non-looping nextAction that tells the model to drop the field.
	// v2.29.x (B2) tightened: the match requires the '… in the <Entity> Entity'
	// tail (only the query engine's entity-field rejection has it), the branch
	// is skipped for picklist-territory messages ('picklist'), and the captured
	// name must not be a query-control token — the documented 'Unable to find
	// limit in the <Entity>' write-field leak is a parameter-set leak, not a
	// phantom filter field.
	const phantomFieldMatch = message.match(/unable to find\s+('([^']+)'|([\w]+))\s+in the\s+[\w]+\s+entity/i);
	if (
		phantomFieldMatch
		&& !lowerMessage.includes('picklist')
		&& !PHANTOM_FIELD_CONTROL_TOKENS.has((phantomFieldMatch[2] ?? phantomFieldMatch[3] ?? '').toLowerCase())
	) {
		const phantomField = phantomFieldMatch[2] ?? phantomFieldMatch[3];
		// Fix round (MINOR-5): the same 'Unable to find X in the <Entity> Entity'
		// body is also emitted on WRITE operations (a field the entity does not
		// accept in the request). The old nextAction only knew read-side filters
		// (filter_field/filtersJson), which writes do not have — a directive that
		// misdirects the model. Gate on the operation: write operations get the
		// write-appropriate corrective (describeFields mode 'write'); read
		// operations keep the query-engine wording.
		const writeBranch = isWriteOperation(operation);
		const summary = writeBranch
			? `Field '${phantomField}' is advertised by describeFields but the Autotask API does not accept it on this entity (phantom field). It cannot be used in requests.`
			: `Filter field '${phantomField}' is advertised by describeFields but the Autotask query engine does not support it (phantom field). It cannot be used in filters.`;
		const nextAction = writeBranch
			? `Remove '${phantomField}' from the write fields (bodyJson/fieldsToMap). Call autotask_${resource} with operation 'describeFields' with mode 'write' to confirm which fields this entity accepts — do NOT retry '${phantomField}' on a write operation.`
			: `Remove '${phantomField}' from filter_field/filter_op/filter_value and filtersJson, and use a field the API query engine supports (for configuration items: 'referenceTitle' with filter_op 'contains' is the viable brand/manufacturer search). Do NOT retry '${phantomField}' — describeFields will keep advertising it.`;
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
			summary,
			nextAction,
		);
	}

	if (
		lowerMessage.includes('lock')
		|| lowerMessage.includes('concurrent')
		|| lowerMessage.includes('deadlock')
	) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.CONCURRENCY_CONFLICT,
			message,
			'Retry with a short backoff and serialise requests for this resource to reduce table lock contention.',
		);
	}

	if (
		lowerMessage.includes('forbidden')
		|| lowerMessage.includes('unauthor')
		|| lowerMessage.includes('permission')
		|| lowerMessage.includes('access denied')
		|| lowerMessage.includes('access is denied')
	) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.PERMISSION_DENIED,
			message,
			`This call is blocked by the account/permission configuration (security level / line-of-business). Do not retry the same call — use a different operation or credential, or ask the user to adjust the API user's permissions. (Data may exist but be inaccessible.)`,
		);
	}

	// v2.28.9 r8 (NIT-2): a FIELD-level "not found" body (e.g. "The picklist field
	// 'status' was not found on entity Ticket") is a schema/metadata problem, not a
	// missing record — the truthful recovery is describeFields, not a record search
	// or a picklist listing. Runs after the required-field classifier (so
	// "Required field … not found in entity …" keeps MISSING_REQUIRED_FIELDS) and
	// before the untagged not-found fallback (which would say ENTITY_NOT_FOUND).
	if (
		!lowerMessage.includes('required')
		&& /\bfield\b[^.\n]{0,40}(was |is |has )?not found|\bno such field\b/.test(lowerMessage)
	) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.INVALID_FIELDS,
			message,
			`Call autotask_${resource} with operation 'describeFields' to verify the field name, then retry with a field the entity publishes.`,
			undefined,
			['describeFields'],
		);
	}

	// v2.28.9 r7 (N4, r8 NIT-1 tightened): the "…is not a valid value for field X"
	// phrasing family is a value/picklist rejection — match the VALUE phrasing
	// explicitly instead of a bare 'is not a valid' clause, which over-matched
	// non-picklist validation bodies ("is not a valid email address", "is not a
	// valid quantity") and sent them down the listPicklistValues recovery path.
	// v2.29.x (V4, wire-found): Autotask's validation bodies append a generic
	// "Use ...listPicklistValues(...)" help line, which used to drag a pure
	// required-field failure into the picklist branch (it runs first). A
	// 'required field' phrase is the dominant signal — yield to the
	// required-field classifier below.
	// Fix round (MINOR-6): the V4 guard tested only the exact substring
	// 'required field'; a body phrased "the following fields are required" that
	// also carries the generic listPicklistValues help line still fell into the
	// picklist branch and lost the required-field directive. Yield whenever the
	// required-field classifier below would claim the body ('required' or
	// 'missing'); when BOTH signals are present emit a combined directive —
	// required-field priority (describeFields mode 'write') with the picklist
	// hint appended, so neither corrective is lost. Required-field-only bodies
	// still fall through to the classifier below (round-4 precedence intact).
	const hasPicklistText =
		lowerMessage.includes('picklist')
		|| lowerMessage.includes('invalid value')
		|| lowerMessage.includes('not a valid value');
	const hasRequiredText = lowerMessage.includes('required') || lowerMessage.includes('missing');
	if (hasPicklistText && hasRequiredText) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.MISSING_REQUIRED_FIELDS,
			message,
			`Call autotask_${resource} with operation 'describeFields' with mode 'write' to review required fields, then retry with all required fields supplied. If any of the failing fields are picklists, also call autotask_${resource} with operation 'listPicklistValues' with the relevant fieldId to get valid values.`,
			undefined,
			['describeFields', 'listPicklistValues'],
		);
	}
	if (hasPicklistText) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.INVALID_PICKLIST_VALUE,
			message,
			`Call autotask_${resource} with operation 'listPicklistValues' with the relevant fieldId, then retry with a valid picklist value.`,
			undefined,
			['listPicklistValues'],
		);
	}

	if (lowerMessage.includes('required') || lowerMessage.includes('missing')) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.MISSING_REQUIRED_FIELDS,
			message,
			`Call autotask_${resource} with operation 'describeFields' with mode 'write', then retry with all required fields.`,
		);
	}

	// v2.28.9 r7 (C2/N3): the UNtagged "not found" / "does not exist" fallback runs
	// AFTER the concurrency, permission, picklist and required-field classifiers — those
	// messages keep their specific actionable types even when they also mention a missing
	// record (previously this check pre-empted all of them: "Picklist value 'foo' not
	// found" and "Required field 'name' not found in entity …" both became
	// ENTITY_NOT_FOUND, and lock/concurrency messages with a not-found phrase lost the
	// CONCURRENCY_CONFLICT type). The TAGGED [NotFoundError…] check above still wins
	// outright for Autotask's canonical not-found bodies (E1, including bodies that hedge
	// with "permission" wording).
	if (
		lowerMessage.includes('not found')
		|| lowerMessage.includes('does not exist')
		|| lowerMessage.includes('no matching records')
	) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.ENTITY_NOT_FOUND,
			message,
			`Use autotask_${resource} with operation 'getMany' and a filter to locate a valid record ID, then retry.`,
		);
	}

	const parentMatch = message.match(/Invalid parent ID type for (\w+)/i);
	if (parentMatch) {
		// resource is a resource key; metadata is keyed by entity name (resourceKey
		// overrides like 'configurationItems' would otherwise miss).
		const parentField = getEntityMetadata(entityNameForResource(resource))?.parentIdField;
		if (parentField) {
			return wrapError(
				resource,
				operation,
				ERROR_TYPES.MISSING_REQUIRED_FIELDS,
				`Missing required parent ID '${parentField}' on ${resource}.${operation} (parent entity: ${parentMatch[1]}).`,
				`Provide '${parentField}' as a top-level field with a valid numeric ID. Call autotask_${resource} with operation 'describeFields' with mode 'write' to confirm required fields.`,
				{ missingFields: [parentField] },
				['describeFields'],
			);
		}
	}

	// v2.29.0 (X7): API method not supported for this resource (HTTP 405). Retrying can
	// never help — tell the model to stop and check the operation list.
	// v2.29.x (B3): one exception — configurationItemRelatedItem.delete 405s on the
	// FLAT route only; supplying the parent identifier (configurationItemID)
	// switches the request to the parent-scoped route, which the API supports, so
	// for that pair the firm "cannot succeed / do not retry" wording is false.
	if (/does not support http method/i.test(message)) {
		if (resource === 'configurationItemRelatedItem' && operation === 'delete') {
			return wrapError(
				resource,
				operation,
				ERROR_TYPES.INVALID_OPERATION,
				`The flat Autotask API route does not support this HTTP method for ${resource} — the parent-scoped route does.`,
				`Supply the parent identifier (configurationItemID) so the API uses the parent-scoped route, then retry autotask_${resource} with operation 'delete'.`,
			);
		}
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.INVALID_OPERATION,
			`The Autotask API does not support this HTTP method for ${resource} — the operation cannot succeed.`,
			`Do not retry this operation. Call autotask_${resource} with operation 'describeOperation' to see what the API supports for this resource, or use a supported operation.`,
			undefined,
			['describeOperation'],
		);
	}

	return wrapError(
		resource,
		operation,
		ERROR_TYPES.API_ERROR,
		message,
		`Verify parameter names and values. If unsure, call autotask_${resource} with operation 'describeFields' first and retry.`,
	);
}

export function formatNotFoundError(resource: string, operation: string, id: number | string): FlatErrorResponse {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.ENTITY_NOT_FOUND,
		`No ${resource} found with id ${id}.`,
		`If the user supplied this ID explicitly, report to the user that no record exists with that ID. Only call getMany if you have other identifying attributes (name, company, date range, or title) to search on.`,
	);
}

export function formatNoResultsFound(resource: string, operation: string, filtersUsed: Record<string, unknown>): FlatErrorResponse {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.NO_RESULTS_FOUND,
		`No ${resource} records matched the supplied filters.`,
		`Broaden or change the filters. Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters.`,
		{ filtersUsed },
	);
}
