import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IApiErrorWithResponse, IApiErrorDetail } from '../types/base/api';

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
 * Formats error details from API response
 */
function formatErrorDetails(errors?: IApiErrorDetail[]): string {
	if (!errors?.length) return '';
	return errors.map(e => e.message).join(', ');
}

/**
 * Gets detailed error context from error object
 */
function getErrorContext(error: Error | IApiErrorWithResponse, operation?: string, entityType?: string): IErrorContext {
	if (!error) {
		return {
			type: AutotaskErrorType.Unknown,
			details: 'An unknown error occurred (no error provided)',
		};
	}

	// Special handling for specific error patterns
	if (error.message) {
		// Check for NotFound errors
		if (error.message.includes('[NotFoundError]') ||
			error.message.toLowerCase().includes('not found') ||
			(error.message.includes('item') && error.message.includes('null'))) {
			return {
				type: AutotaskErrorType.NotFound,
				details: error.message,
			};
		}
	}

	if ('response' in error) {
		const status = error.response?.status;

		// Extract detailed error information if available
		if (error.response?.data && 'errors' in error.response.data) {
			const errorData = error.response.data;

			// Format detailed error messages if available
			if (Array.isArray(errorData.errors) && errorData.errors.length > 0) {
				const errorDetails = errorData.errors.map((e: IApiErrorDetail) => {
					let message = e.message || 'Unknown error';
					if (e.field) {
						message = `Field '${e.field}': ${message}`;
					}
					if (e.code) {
						message = `[${e.code}] ${message}`;
					}
					return message;
				}).join(' | ');

				// Use detailed error messages in the context
				const errorContext = {
					type: getErrorTypeByStatus(status),
					statusCode: status,
					details: errorDetails || formatErrorDetails(errorData.errors) || 'API error occurred',
				};

				return errorContext;
			}
		}

		switch (status) {
			case 400:
				return {
					type: AutotaskErrorType.BadRequest,
					statusCode: status,
					details: formatErrorDetails(error.response?.data?.errors) || 'Invalid request format or parameters',
				};
			case 401:
				return {
					type: AutotaskErrorType.Authentication,
					statusCode: status,
					details: 'Authentication failed: Invalid credentials',
				};
			case 403:
				return {
					type: AutotaskErrorType.Authorization,
					statusCode: status,
					details: 'Authorization failed: Insufficient permissions',
				};
			case 404:
				return {
					type: AutotaskErrorType.NotFound,
					statusCode: status,
					details: `Resource not found${entityType ? `: ${entityType}` : ''}`,
				};
			case 409:
				return {
					type: AutotaskErrorType.Conflict,
					statusCode: status,
					details: 'Resource state conflict',
				};
			case 422:
				return {
					type: AutotaskErrorType.Validation,
					statusCode: status,
					details: formatErrorDetails(error.response?.data?.errors) || 'Validation error',
				};
			case 429:
				return {
					type: AutotaskErrorType.TooManyRequests,
					statusCode: status,
					details: 'Rate limit exceeded',
				};
			case 500:
				return {
					type: AutotaskErrorType.InternalServer,
					statusCode: status,
					details: 'Internal server error',
				};
			case 503:
				return {
					type: AutotaskErrorType.ServiceUnavailable,
					statusCode: status,
					details: 'Service temporarily unavailable',
				};
			case 504:
				return {
					type: AutotaskErrorType.GatewayTimeout,
					statusCode: status,
					details: 'Gateway timeout',
				};
			default:
				if (status && status >= 400 && status < 500) {
					return {
						type: AutotaskErrorType.BadRequest,
						statusCode: status,
						details: formatErrorDetails(error.response?.data?.errors) || `Client error: ${status}`,
					};
				}
				if (status && status >= 500) {
					return {
						type: AutotaskErrorType.InternalServer,
						statusCode: status,
						details: `Server error: ${status}`,
					};
				}
		}
	}

	if (error instanceof Error) {
		if (error.name === 'NetworkError') {
			return {
				type: AutotaskErrorType.Network,
				details: error.message || 'Network connection error',
			};
		}
		if (error.name === 'TimeoutError') {
			return {
				type: AutotaskErrorType.Timeout,
				details: error.message || 'Request timeout',
			};
		}
		if (error.name === 'SyntaxError' || error.name === 'TypeError') {
			return {
				type: AutotaskErrorType.ParseError,
				details: error.message || 'Failed to parse API response',
			};
		}
	}

	return {
		type: AutotaskErrorType.Unknown,
		details: error.message || 'An unknown error occurred',
	};
}

/**
 * Gets error type based on HTTP status code
 */
function getErrorTypeByStatus(status?: number): AutotaskErrorType {
	if (!status) return AutotaskErrorType.Unknown;

	if (status === 401) return AutotaskErrorType.Authentication;
	if (status === 403) return AutotaskErrorType.Authorization;
	if (status === 404) return AutotaskErrorType.NotFound;
	if (status === 400) return AutotaskErrorType.BadRequest;
	if (status === 422) return AutotaskErrorType.Validation;
	if (status === 409) return AutotaskErrorType.Conflict;
	if (status === 429) return AutotaskErrorType.TooManyRequests;
	if (status === 500) return AutotaskErrorType.InternalServer;
	if (status === 503) return AutotaskErrorType.ServiceUnavailable;
	if (status === 504) return AutotaskErrorType.GatewayTimeout;

	if (status >= 400 && status < 500) return AutotaskErrorType.BadRequest;
	if (status >= 500) return AutotaskErrorType.InternalServer;

	return AutotaskErrorType.Unknown;
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
		const lastError = error instanceof Error ? error : new Error('Unknown error');
		const errorContext = getErrorContext(lastError, opName, entityType);

		if (!context) {
			throw lastError;
		}

		throw new NodeOperationError(context.getNode(), lastError, {
			description: errorContext.details,
			message: `[${errorContext.type}] ${opName ? `Operation: ${opName}, ` : ''}${entityType ? `Entity: ${entityType}, ` : ''}${errorContext.details}`,
		});
	}
}
