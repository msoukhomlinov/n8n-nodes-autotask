/**
 * Centralized error-related constants for the Autotask integration.
 *
 * This file contains all error-related constants including:
 * - Error categories
 * - Error tags
 * - Message templates
 * - Warning templates
 * - Error types
 * - HTTP status codes
 *
 * @remarks
 * Error handling follows these principles:
 * 1. Consistent error categorization
 * 2. Clear error messages with context
 * 3. Graceful fallback handling
 * Breaking changes should be documented here.
 */

/**
 * Error categories for different types of errors
 * @example
 * API_ERROR: API communication errors (e.g., network issues, invalid responses)
 * VALIDATION_ERROR: Data validation errors (e.g., invalid field values)
 */
export const ERROR_CATEGORIES = {
	/** API communication errors (e.g., network issues, invalid responses) */
	API_ERROR: 'API_ERROR',
	/** Data validation errors (e.g., invalid field values, missing required fields) */
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	/** Data processing errors (e.g., type conversion failures, mapping errors) */
	PROCESSING_ERROR: 'PROCESSING_ERROR',
	/** System/runtime errors (e.g., configuration issues, internal errors) */
	SYSTEM_ERROR: 'SYSTEM_ERROR',
} as const;

/**
 * Error tags for consistent error source identification
 * @remarks Used to identify the component that generated the error
 */
export const ERROR_TAGS = {
	/** Autotask API-related errors */
	AUTOTASK: 'Autotask',
	/** Error handler component errors */
	ERROR_HANDLER: 'ErrorHandler',
} as const;

/**
 * Common error messages for standard error scenarios
 * @remarks Used for consistent error messaging across the application
 */
export const ERROR_MESSAGES = {
	/** Generic operation failure message */
	OPERATION_FAILED: 'Operation failed',
	/** Generic unknown error message */
	UNKNOWN_ERROR: 'Unknown error occurred',
} as const;

/**
 * Error message templates for consistent error reporting
 * @remarks
 * Templates use placeholders:
 * - {type}: Error type
 * - {entity}: Entity being processed
 * - {details}: Specific error details
 * - {operation}: Operation being performed
 *
 * @example
 * Format: '[ValidationError] Validation failed for Task: Invalid status value'
 */
export const ERROR_TEMPLATES = {
	/** Template for validation errors */
	validation: '[{type}] Validation failed for {entity}: {details}',
	/** Template for not found errors */
	notFound: '[{type}] {entity} not found: {details}',
	/** Template for operation errors */
	operation: '[{type}] {operation} failed for {entity}: {details}',
	/** Template for reference loading errors */
	reference: '[{type}] Failed to load reference values for {entity}: {details}',
	/** Template for system errors */
	system: '[{type}] System error: {details}',
} as const;

/**
 * Warning message templates for non-critical errors
 * @remarks
 * Used for issues that don't prevent operation but should be logged
 *
 * @example
 * Format: 'Reference load warning for Task: Partial data available'
 */
export const WARNING_TEMPLATES = {
	/** Template for reference loading warnings */
	reference: 'Reference load warning for {entity}: {details}',
	/** Template for validation warnings */
	validation: 'Validation warning for {entity}: {details}',
} as const;

/**
 * Field validation error templates for specific validation scenarios
 * @remarks
 * Templates use placeholders specific to field validation:
 * - {fieldName}: Name of the field being validated
 * - {expectedType}: Expected data type
 * - {actualType}: Actual data type received
 * - {value}: Invalid value
 * - {entityType}: Type of entity
 * - {id}: Entity identifier
 * - {details}: Additional error details
 */
export const FIELD_VALIDATION_ERRORS = {
	/** Template for invalid reference type errors */
	INVALID_REFERENCE_TYPE: 'Invalid reference type: {fieldName} expects {expectedType} but received {actualType}',
	/** Template for missing required reference errors */
	MISSING_REQUIRED_REFERENCE: 'Missing required reference value for field: {fieldName}',
	/** Template for invalid reference value errors */
	INVALID_REFERENCE_VALUE: 'Invalid reference value for {fieldName}: {value}',
	/** Template for reference entity not found errors */
	REFERENCE_ENTITY_NOT_FOUND: 'Reference entity not found: {entityType} with ID {id}',
	/** Template for reference cache errors */
	REFERENCE_CACHE_ERROR: 'Failed to validate reference from cache: {details}',
	/** Template for reference validation failures */
	REFERENCE_VALIDATION_FAILED: 'Reference validation failed for {fieldName}: {details}',
} as const;

/**
 * Field validation warning templates for non-critical validation issues
 * @remarks
 * Templates use placeholders specific to field validation warnings:
 * - {fieldName}: Name of the field being validated
 * - {reason}: Reason for fallback validation
 * - {details}: Additional warning details
 */
export const FIELD_VALIDATION_WARNINGS = {
	/** Template for reference cache miss warnings */
	REFERENCE_CACHE_MISS: 'Cache miss for reference validation: {fieldName}',
	/** Template for reference validation fallback warnings */
	REFERENCE_FALLBACK_MODE: 'Using fallback validation for {fieldName}: {reason}',
	/** Template for degraded validation mode warnings */
	REFERENCE_VALIDATION_DEGRADED: 'Degraded validation mode for {fieldName}: {details}',
} as const;

/**
 * Error types for specific error conditions
 * @remarks Used to categorize specific types of errors for handling
 */
export const ERROR_TYPES = {
	/** Bad request errors (e.g., invalid parameters) */
	BAD_REQUEST: 'BadRequest',
	/** Authentication errors (e.g., invalid credentials) */
	AUTHENTICATION: 'Authentication',
	/** Authorization errors (e.g., insufficient permissions) */
	AUTHORIZATION: 'Authorization',
	/** Not found errors (e.g., invalid entity ID) */
	NOT_FOUND: 'NotFound',
	/** Conflict errors (e.g., duplicate entries) */
	CONFLICT: 'Conflict',
	/** Validation errors (e.g., invalid field values) */
	VALIDATION: 'Validation',
	/** Rate limit errors (e.g., too many requests) */
	RATE_LIMIT: 'RateLimit',
	/** Internal server errors */
	INTERNAL_SERVER: 'InternalServer',
	/** Service unavailable errors */
	SERVICE_UNAVAILABLE: 'ServiceUnavailable',
} as const;

/**
 * HTTP status codes for API responses
 * @remarks
 * Maps standard HTTP status codes to their meanings
 * Used to determine appropriate error handling
 */
export const HTTP_STATUS = {
	/** Bad Request - 400 */
	BAD_REQUEST: 400,
	/** Unauthorized - 401 */
	UNAUTHORIZED: 401,
	/** Forbidden - 403 */
	FORBIDDEN: 403,
	/** Not Found - 404 */
	NOT_FOUND: 404,
	/** Conflict - 409 */
	CONFLICT: 409,
	/** Unprocessable Entity - 422 */
	UNPROCESSABLE_ENTITY: 422,
	/** Too Many Requests - 429 */
	TOO_MANY_REQUESTS: 429,
	/** Internal Server Error - 500 */
	INTERNAL_SERVER_ERROR: 500,
	/** Service Unavailable - 503 */
	SERVICE_UNAVAILABLE: 503,
} as const;
