/**
 * Centralized UI/display-related constants for the Autotask integration.
 *
 * This file contains all UI-related constants including:
 * - Field display settings
 * - Description formatting
 * - Number formatting options
 * - UI labels and messages
 * - Field validation messages
 *
 * @remarks
 * UI formatting follows these principles:
 * 1. Consistent display patterns
 * 2. Clear and descriptive labels
 * 3. Helpful validation messages
 * 4. Proper number formatting
 * Breaking changes should be documented here.
 */

/** Documentation for the UI constants module */
export const UI_MODULE_DOC = {
	description: `Centralized UI/display-related constants for the Autotask integration.

This file contains all UI-related constants including:
- Field display settings
- Description formatting
- Number formatting options
- UI labels and messages
- Field validation messages

UI formatting follows these principles:
1. Consistent display patterns
2. Clear and descriptive labels
3. Helpful validation messages
4. Proper number formatting
Breaking changes should be documented here.`,
} as const;

/**
 * Field display settings for consistent UI presentation
 * @remarks Used to format field values in the UI
 *
 * @example
 * With separator: 'First Last'
 * With bracket: 'Name (ID)'
 * Empty value: '(empty)'
 */
export const FIELD_DISPLAY = {
	/** Default separator between field values */
	DEFAULT_SEPARATOR: ' ',
	/** Format for bracketed values */
	BRACKET_FORMAT: '({value})',
	/** Display text for empty values */
	EMPTY_VALUE: '(empty)',
	/** Display text for unknown values */
	UNKNOWN_VALUE: '(unknown)',
} as const;

/**
 * Field description formatting settings
 * @remarks Used to generate consistent field descriptions
 *
 * @example
 * Full description: 'Type: String | Required | Read-only'
 */
export const FIELD_DESCRIPTION = {
	/** Label for field type in descriptions */
	TYPE_LABEL: 'Type:',
	/** Label for required fields */
	REQUIRED_LABEL: 'Required',
	/** Label for read-only fields */
	READ_ONLY_LABEL: 'Read-only',
	/** Separator between description parts */
	SEPARATOR: ' | ',
} as const;

/**
 * Number formatting options for different contexts
 * @remarks
 * Defines how numbers are displayed in various formats
 *
 * @example
 * Currency: '$1,234.56'
 * Percentage: '12.34%'
 * Decimal: '1,234.56'
 */
export const NUMBER_FORMATS = {
	/** Currency formatting options */
	CURRENCY: {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	},
	/** Percentage formatting options */
	PERCENTAGE: {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	},
	/** Decimal number formatting options */
	DECIMAL: {
		style: 'decimal',
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	},
} as const;

/**
 * UI labels for various field types and options
 * @remarks
 * Provides consistent labeling across the UI
 */
export const UI_LABELS = {
	/** Labels for field types */
	FIELD_TYPES: {
		STRING: 'Text',
		NUMBER: 'Number',
		BOOLEAN: 'Yes/No',
		DATE: 'Date',
		DATETIME: 'Date & Time',
		LIST: 'List',
	},
	/** Options for boolean fields */
	BOOLEAN_OPTIONS: [
		{
			name: 'Yes',
			value: true,
			description: 'Set field to true',
		},
		{
			name: 'No',
			value: false,
			description: 'Set field to false',
		},
	],
} as const;

/**
 * UI messages for validation and user feedback
 * @remarks
 * Used to provide consistent user feedback
 *
 * @example
 * Required field: 'This field is required'
 * Invalid format: 'Invalid date format. Use YYYY-MM-DD'
 */
export const UI_MESSAGES = {
	/** Message for required fields */
	REQUIRED_FIELD: 'This field is required',
	/** Message for invalid format */
	INVALID_FORMAT: 'Invalid format. Please check the required format',
	/** Message for invalid value */
	INVALID_VALUE: 'Invalid value. Please check the allowed values',
	/** Message for out of range values */
	OUT_OF_RANGE: 'Value is out of allowed range',
} as const;
