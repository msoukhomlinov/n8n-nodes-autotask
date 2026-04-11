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
} as const;

// ---------------------------------------------------------------------------
// Flat Response Standard (v2)
// ---------------------------------------------------------------------------

export interface FlatErrorResponse {
	error: true;
	errorType: string;
	resource: string;
	operation: string;
	summary: string;
	nextAction: string;
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
export function wrapError(
	resource: string,
	operation: string,
	errorType: string,
	summary: string,
	nextAction: string,
	contextFields?: Record<string, unknown>,
): FlatErrorResponse {
	return {
		error: true,
		errorType,
		resource,
		operation: `${resource}.${operation}`,
		summary,
		nextAction,
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

export function formatApiError(
	message: string,
	resource: string,
	operation: string,
): FlatErrorResponse {
	const lowerMessage = message.toLowerCase();

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
		`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
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
