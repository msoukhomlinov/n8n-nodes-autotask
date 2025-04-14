/**
 * Error classes and types
 */
export class AutotaskZoneError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AutotaskZoneError';
		Object.setPrototypeOf(this, AutotaskZoneError.prototype);
	}
}

export type ErrorCode =
	| 'ZONE_NOT_FOUND'
	| 'AUTHENTICATION_FAILED'
	| 'RATE_LIMIT_EXCEEDED'
	| 'INVALID_REQUEST'
	| 'RESOURCE_NOT_FOUND'
	| 'SERVER_ERROR';

/**
 * Enhanced error interfaces for standardized error handling
 */
export interface IAutotaskErrorDetail {
	message: string;
	field?: string;
	code?: string;
}

export interface IAutotaskErrorResponse {
	errors?: IAutotaskErrorDetail[];
}

export interface IAutotaskError {
	statusCode?: number;
	message: string;
	details?: IAutotaskErrorDetail[];
	context?: {
		url?: string;
		method?: string;
		errorDetails?: IAutotaskErrorDetail[];
		rawResponse?: string;
		operation?: string;
		entityType?: string;
	};
}

