import type { LabelResolution, PendingLabelConfirmation } from '../helpers/label-resolution';

// ---------------------------------------------------------------------------
// Result Envelope Standard (v1)
// ---------------------------------------------------------------------------

export interface SuccessEnvelope {
	schemaVersion: '1';
	success: true;
	resource: string;
	operation: string;
	result: unknown;
}

// ---------------------------------------------------------------------------
// Result Envelope Standard v2 — ResultPayload
// ---------------------------------------------------------------------------

export type ResultKind =
	| 'item'      // get, whoAmI, slaHealthCheck, getByResource, getByYear
	| 'list'      // getMany, getPosted, getUnposted, searchByDomain
	| 'count'
	| 'mutation'  // create, update, delete, approve, reject, moveConfigurationItem, moveToCompany, transferOwnership
	| 'compound'  // createIfNotExists
	| 'summary'   // ticket.summary
	| 'metadata'; // describeFields, listPicklistValues

export interface ResultFlags {
	mutated: boolean;
	/** Safe to retry with the same parameters without unintended side effects. False for create. */
	retryable: boolean;
	/** Completed but a resolution failure may have affected written data. */
	partial: boolean;
	truncated: boolean;
	needsUserConfirmation: boolean;
	/** !needsUserConfirmation && !partial. False = stop and present to user before continuing. */
	safeToContinue: boolean;
}

export interface PaginationInfo {
	offset: number;
	hasMore: boolean;
	nextOffset?: number;
	totalAvailable?: number;
}

export interface ResultPayload {
	kind: ResultKind;
	data: unknown;
	flags: ResultFlags;
	/** Actionable: resolution failures, data correctness concerns, recency window overflow. */
	warnings: string[];
	/** Always present. Non-empty means LLM must confirm before proceeding. */
	pendingConfirmations: PendingLabelConfirmation[];
	/** Always present. Labels auto-resolved to IDs for this operation. */
	appliedResolutions: LabelResolution[];
	/** Present only for list kind. */
	pagination?: PaginationInfo;
	/** Informational only: pagination hints, recency context, query behaviour notes. */
	notes?: string[];
}

export interface ErrorEnvelope {
	schemaVersion: '1';
	error: true;
	errorType: string;
	resource: string;
	operation: string;
	message: string;
	nextAction: string;
	context?: Record<string, unknown>;
}

/** @deprecated Use ErrorEnvelope instead */
export type StructuredToolError = ErrorEnvelope;

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
} as const;

// ---------------------------------------------------------------------------
// Envelope factories
// ---------------------------------------------------------------------------

function buildOperationString(resource: string, operation: string): string {
	return `${resource}.${operation}`;
}

export function wrapSuccess(resource: string, operation: string, result: unknown): SuccessEnvelope {
	return {
		schemaVersion: '1',
		success: true,
		resource,
		operation: buildOperationString(resource, operation),
		result,
	};
}

export function wrapError(
	resource: string,
	operation: string,
	errorType: string,
	message: string,
	nextAction: string,
	context?: Record<string, unknown>,
): ErrorEnvelope {
	return {
		schemaVersion: '1',
		error: true,
		errorType,
		resource,
		operation: buildOperationString(resource, operation),
		message,
		nextAction,
		...(context ? { context } : {}),
	};
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
): ErrorEnvelope {
	const mode = errorType === 'INVALID_FIELDS' ? 'read' : 'write';
	return wrapError(
		resource,
		operation,
		errorType,
		`Invalid field name(s) for ${buildOperationString(resource, operation)}: ${invalidFields.join(', ')}`,
		`Call autotask_${resource} with operation 'describeFields' with mode '${mode}', then retry with valid field names.`,
		{ invalidFields, validFieldsSample },
	);
}

export function formatRequiredFieldsError(
	resource: string,
	operation: string,
	missingFields: string[],
): ErrorEnvelope {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.MISSING_REQUIRED_FIELDS,
		`Missing required field(s) for ${buildOperationString(resource, operation)}: ${missingFields.join(', ')}`,
		`Call autotask_${resource} with operation 'describeFields' with mode 'write' to review required fields, then retry.`,
		{ missingFields },
	);
}

export function formatIdError(resource: string, operation: string): ErrorEnvelope {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.MISSING_ENTITY_ID,
		`A numeric entity ID is required for ${buildOperationString(resource, operation)}.`,
		`Provide a numeric ID. If unknown, call autotask_${resource} with operation 'getMany' to locate the correct record first.`,
	);
}

export function formatFilterConstraintError(
	resource: string,
	operation: string,
	message: string,
	nextAction: string,
): ErrorEnvelope {
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
): ErrorEnvelope {
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

export function formatNotFoundError(resource: string, operation: string, id: number | string): ErrorEnvelope {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.ENTITY_NOT_FOUND,
		`No ${resource} found with id ${id}.`,
		`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
	);
}

export function formatNoResultsFound(resource: string, operation: string, filtersUsed: Record<string, unknown>): ErrorEnvelope {
	return wrapError(
		resource,
		operation,
		ERROR_TYPES.NO_RESULTS_FOUND,
		`No ${resource} records matched the supplied filters.`,
		`Broaden or change the filters. Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters.`,
		{ filtersUsed },
	);
}
