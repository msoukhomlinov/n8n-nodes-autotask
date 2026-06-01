import { getEntityMetadata } from '../constants/entities';

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
	) {
		return wrapError(
			resource,
			operation,
			ERROR_TYPES.PERMISSION_DENIED,
			message,
			'Verify API user security level and line-of-business permissions. Data can exist but still be inaccessible.',
		);
	}

	if (lowerMessage.includes('picklist') || lowerMessage.includes('invalid value')) {
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

	if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
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
		const parentField = getEntityMetadata(resource)?.parentIdField;
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
