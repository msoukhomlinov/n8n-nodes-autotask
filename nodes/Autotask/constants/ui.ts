/**
 * Centralized UI/display-related constants for the Autotask integration
 */

/** Field display settings */
export const FIELD_DISPLAY = {
	/** Default field separator */
	DEFAULT_SEPARATOR: ' ',
	/** Default bracket format */
	BRACKET_FORMAT: '({value})',
	/** Empty value display */
	EMPTY_VALUE: '(empty)',
	/** Unknown value display */
	UNKNOWN_VALUE: '(unknown)',
} as const;

/** Field description formats */
export const FIELD_DESCRIPTION = {
	/** Type label */
	TYPE_LABEL: 'Type:',
	/** Required label */
	REQUIRED_LABEL: 'Required',
	/** Read-only label */
	READ_ONLY_LABEL: 'Read-only',
	/** Description separator */
	SEPARATOR: ' | ',
} as const;

/** Number display formats */
export const NUMBER_FORMATS = {
	/** Currency format */
	CURRENCY: {
		style: 'currency',
		currency: 'USD',
	},
	/** Percentage format */
	PERCENTAGE: {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	},
	/** Decimal format */
	DECIMAL: {
		style: 'decimal',
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	},
} as const;

/** UI labels */
export const UI_LABELS = {
	/** Field type labels */
	FIELD_TYPES: {
		STRING: 'Text',
		NUMBER: 'Number',
		BOOLEAN: 'Yes/No',
		DATE: 'Date',
		DATETIME: 'Date & Time',
		LIST: 'List',
		REFERENCE: 'Reference',
	},
	/** Boolean field options */
	BOOLEAN_OPTIONS: {
		TRUE: {
			name: 'Yes',
			value: true,
			description: 'Set field value to true',
		},
		FALSE: {
			name: 'No',
			value: false,
			description: 'Set field value to false',
		},
	},
} as const;

/** UI validation messages */
export const UI_MESSAGES = {
	/** Required field message */
	REQUIRED_FIELD: 'This field is required',
	/** Invalid format message */
	INVALID_FORMAT: 'Invalid format',
	/** Invalid value message */
	INVALID_VALUE: 'Invalid value',
	/** Out of range message */
	OUT_OF_RANGE: 'Value out of range',
} as const;

// Export all constants
export default {
	FIELD_DISPLAY,
	FIELD_DESCRIPTION,
	NUMBER_FORMATS,
	UI_LABELS,
	UI_MESSAGES,
};
