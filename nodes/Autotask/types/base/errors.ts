
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

