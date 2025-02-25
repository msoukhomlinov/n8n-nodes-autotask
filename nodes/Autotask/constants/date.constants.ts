/** Documentation for the date/time constants module */
export const DATE_MODULE_DOC = {
	description: `Centralized date/time format constants for the Autotask integration.

This file contains all date/time-related constants including:
- API date/time formats
- Display formats
- Timezone settings
- Date processing settings
- Validation patterns

All dates in the Autotask API are handled in UTC timezone.
Date formats follow Moment.js patterns.
Breaking changes should be documented here.`,
} as const;

/**
 * Date format patterns for various contexts
 * @example
 * API_DATE: '2024-03-21'
 * API_DATETIME: '2024-03-21T14:30:00.000Z'
 * DISPLAY_DATETIME: '2024-03-21 14:30:00'
 */
export const DATE_FORMATS = {
	/** API date format (ISO 8601) - YYYY-MM-DD */
	API_DATE: 'YYYY-MM-DD',
	/** API datetime format (ISO 8601) with timezone - YYYY-MM-DDTHH:mm:ss.SSSZ */
	API_DATETIME: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
	/** Default timezone for all API operations */
	TIMEZONE: 'UTC',
	/** Date-only display format - YYYY-MM-DD */
	DISPLAY_DATE: 'YYYY-MM-DD',
	/** Datetime display format - YYYY-MM-DD HH:mm:ss */
	DISPLAY_DATETIME: 'YYYY-MM-DD HH:mm:ss',
	/** Time-only display format - HH:mm:ss */
	DISPLAY_TIME: 'HH:mm:ss',
} as const;

/**
 * Date processing settings for handling date/time values
 * @remarks
 * These settings control how dates are processed and displayed
 */
export const DATE_SETTINGS = {
	/** Whether to include milliseconds in datetime values (required for API) */
	INCLUDE_MILLISECONDS: true,
	/** Default timezone if none specified (always UTC for API) */
	DEFAULT_TIMEZONE: 'UTC',
	/** Whether to convert dates to local timezone (disabled by default) */
	CONVERT_TO_LOCAL: false,
} as const;

/**
 * Regular expression patterns for date validation
 * @example
 * API_DATETIME_PATTERN matches: '2024-03-21T14:30:00.000Z'
 * API_DATE_PATTERN matches: '2024-03-21'
 */
export const DATE_PATTERNS = {
	/** Regex pattern for API datetime format validation */
	API_DATETIME_PATTERN: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
	/** Regex pattern for API date format validation */
	API_DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
} as const;
