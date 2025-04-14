import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IApiErrorWithResponse, IApiErrorDetail } from '../types/base/api';
import type { IAutotaskErrorDetail, IAutotaskError } from '../types/base/errors';

/**
 * Autotask error types with their corresponding HTTP status codes
 */
export enum AutotaskErrorType {
	// Authentication & Authorization errors
	Authentication = 'AuthenticationError_401', // Invalid credentials
	Authorization = 'AuthorizationError_403', // Valid credentials but insufficient permissions

	// Client errors
	BadRequest = 'BadRequestError_400', // Malformed request
	Validation = 'ValidationError_422', // Request format ok but data invalid
	NotFound = 'NotFoundError_404', // Resource not found
	Conflict = 'ConflictError_409', // Resource state conflict
	TooManyRequests = 'TooManyRequestsError_429', // Rate limit exceeded

	// Server errors
	InternalServer = 'InternalServerError_500', // Generic server error
	ServiceUnavailable = 'ServiceUnavailableError_503', // Service temporarily unavailable
	GatewayTimeout = 'GatewayTimeoutError_504', // API gateway timeout

	// Network & System errors
	Network = 'NetworkError', // Connection/DNS issues
	Timeout = 'TimeoutError', // Request timeout
	ParseError = 'ParseError', // Response parsing failed

	// Fallback
	Unknown = 'UnknownError' // Unhandled error types
}

/**
 * Error context for better debugging
 */
interface IErrorContext {
	type: AutotaskErrorType;
	operation?: string;
	entityType?: string;
	statusCode?: number;
	details?: string;
}

/**
 * Formats error details from API response with enhanced context
 */
function formatErrorDetails(errors?: IApiErrorDetail[] | IAutotaskErrorDetail[]): string {
	if (!errors?.length) return '';

	return errors.map(e => {
		let message = e.message || 'Unknown error';
		if (e.field) {
			message = `Field '${e.field}': ${message}`;
		}
		if (e.code) {
			message = `[${e.code}] ${message}`;
		}
		return message;
	}).join(' | ');
}

/**
 * Gets error type based on multiple context factors
 * Consolidated error type classification function
 */
function getErrorTypeByContext(
	status?: number,
	message?: string,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	errors?: IApiErrorDetail[] | IAutotaskErrorDetail[]
): AutotaskErrorType {
	// Special case handling for message patterns
	if (message) {
		if (message.includes('[NotFoundError]') ||
			message.toLowerCase().includes('not found') ||
			(message.includes('item') && message.includes('null'))) {
			return AutotaskErrorType.NotFound;
		}
	}

	// In Phase 2, we'll use errors parameter to detect business rule violations
	// Currently unused but keeping the parameter for future implementation

	// Status-based classification
	if (!status) return AutotaskErrorType.Unknown;

	// Map status codes to error types
	const statusErrorMap: Record<number, AutotaskErrorType> = {
		400: AutotaskErrorType.BadRequest,
		401: AutotaskErrorType.Authentication,
		403: AutotaskErrorType.Authorization,
		404: AutotaskErrorType.NotFound,
		409: AutotaskErrorType.Conflict,
		422: AutotaskErrorType.Validation,
		429: AutotaskErrorType.TooManyRequests,
		500: AutotaskErrorType.InternalServer,
		503: AutotaskErrorType.ServiceUnavailable,
		504: AutotaskErrorType.GatewayTimeout,
	};

	if (statusErrorMap[status]) return statusErrorMap[status];

	if (status >= 400 && status < 500) return AutotaskErrorType.BadRequest;
	if (status >= 500) return AutotaskErrorType.InternalServer;

	return AutotaskErrorType.Unknown;
}

/**
 * Creates a standardized error context object from various error types
 */
function getErrorContext(error: Error | IApiErrorWithResponse, operation?: string, entityType?: string): IErrorContext {
	if (!error) {
		return {
			type: AutotaskErrorType.Unknown,
			details: 'An unknown error occurred (no error provided)',
		};
	}

	let details = '';
	let statusCode;
	let specificErrors: IApiErrorDetail[] | IAutotaskErrorDetail[] = [];

	// Extract status code and attempt to extract specific error details from the response
	if ('response' in error && error.response) {
		statusCode = error.response.status;

		// Check for the errors array in the response data
		if (error.response.data && Array.isArray(error.response.data.errors) && error.response.data.errors.length > 0) {
			specificErrors = error.response.data.errors;
			details = formatErrorDetails(specificErrors);
		}
	}

	// If no specific details were extracted from the response body, use the general error message
	if (!details && error.message) {
		details = error.message;
	}

	// Determine the error type based on context (status code, message, and specific errors if available)
	const type = getErrorTypeByContext(
		statusCode,
		error.message, // Pass the general message for context
		specificErrors // Pass the specific errors for potential type refinement
	);

	return {
		type,
		operation,
		entityType,
		statusCode,
		details: details || 'An error occurred', // Ensure we always have a details string
	};
}

/**
 * Creates a standardized error object with consistent structure
 */
export function createStandardErrorObject(error: Error | IApiErrorWithResponse, context: {
	url: string;
	method: string;
	status?: number;
	operation?: string;
	entityType?: string;
}): IAutotaskError {
	const { url, method, status, operation, entityType } = context;
	let details: IAutotaskErrorDetail[] = [];

	// Extract details from API error response
	if ('response' in error && error.response?.data?.errors) {
		if (Array.isArray(error.response.data.errors)) {
			details = error.response.data.errors;
		}
	}

	// Get error context information
	const errorContext = getErrorContext(error, operation, entityType);

	// Prepare the rawResponse with proper type guard
	const rawResponse = 'response' in error && error.response?.data
		? JSON.stringify(error.response.data)
		: undefined;

	return {
		statusCode: status,
		message: errorContext.details || error.message || 'Unknown error',
		details,
		context: {
			url,
			method,
			operation,
			entityType,
			errorDetails: details,
			rawResponse
		}
	};
}

/**
 * Wrap an operation with error handling
 */
export async function handleErrors<T>(
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | undefined,
	operation: () => Promise<T>,
	metadata?: {
		operation?: string;
		entityType?: string;
	},
): Promise<T> {
	const { operation: opName, entityType } = metadata || {};

	try {
		return await operation();
	} catch (error) {
		// Get standardized error context
		const errorContext = getErrorContext(error as Error | IApiErrorWithResponse, opName, entityType);

		// Check if error.message or error.description have been set by request.ts
		// This preserves specific API error messages formatted in the request handler
		const errorMessage = (error as { description?: string }).description ||
			(error as Error).message ||
			errorContext.details ||
			'An unknown error occurred';

		// Look for errors array in various locations
		const apiErrors =
			((error as IApiErrorWithResponse).response?.data?.errors) || // Direct from response
			((error as { error?: { errors?: IApiErrorDetail[] | IAutotaskErrorDetail[] } }).error?.errors) || // From standardized error object
			[];

		// Format API-specific error message if available but not already formatted
		const formattedApiErrors = Array.isArray(apiErrors) && apiErrors.length > 0
			? apiErrors.map((e: IApiErrorDetail | IAutotaskErrorDetail | string) =>
				typeof e === 'string' ? e : e.message).filter(Boolean).join(' | ')
			: '';

		// Use the most specific error message available with priority:
		// 1. Pre-formatted message from request.ts
		// 2. API errors array formatted here
		// 3. Error context details
		// 4. Generic message
		const detailedMessage = errorMessage !== 'An unknown error occurred'
			? errorMessage
			: formattedApiErrors || errorContext.details || 'An unknown error occurred';

		// Throw n8n error with consistent formatting
		if (context) {
			throw new NodeOperationError(
				context.getNode(),
				detailedMessage,
				{ itemIndex: 0 }
			);
		}

		// If no context available, rethrow with enhanced message
		throw new Error(`${detailedMessage} [${errorContext.type}]`);
	}
}
