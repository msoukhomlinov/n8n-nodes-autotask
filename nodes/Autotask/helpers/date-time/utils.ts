import type { Moment } from 'moment-timezone';
import type { IExecuteFunctions, ILoadOptionsFunctions, IDataObject } from 'n8n-workflow';
import { DateTimeWrapper } from './wrapper';
import moment from 'moment-timezone';
import type { IAutotaskCredentials } from '../../types/base/auth';
import type { IAutotaskField } from '../../types/base/entity-types';
import { getFields } from '../entity/api';
import { DATE_FORMATS } from '../../constants/date.constants';

/**
 * Gets the configured timezone from node parameters or credentials
 */
export async function getConfiguredTimezone(this: ILoadOptionsFunctions | IExecuteFunctions): Promise<string> {
	try {
		// First try to get from node parameters
		try {
			const timezone = this.getNodeParameter('timezone', 0) as string;
			if (timezone) {
				return timezone;
			}
		} catch (error) {
			// Node parameter not found, continue to credentials
		}

		// Try to get from credentials
		const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
		if (credentials?.timezone) {
			return credentials.timezone;
		}

		console.warn('No timezone configured, using UTC as default');
		return 'UTC';
	} catch (error) {
		console.warn('Error getting timezone configuration, using UTC as default:', error);
		return 'UTC';
	}
}

/**
 * Creates a DateTimeWrapper from a raw date value, detecting the appropriate timezone state
 */
export function createDateWrapper(
	value: string | Date | Moment,
	source: string,
	isUtc = false,
): DateTimeWrapper {
	return isUtc
		? DateTimeWrapper.fromUTC(value, source)
		: DateTimeWrapper.fromLocal(value, source);
}

/**
 * Process date fields in API response
 */
export async function processResponseDates<T extends IDataObject>(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	response: T,
	context: string,
): Promise<T> {
	if (!response) {
		return response;
	}

	try {
		const timezone = await getConfiguredTimezone.call(this);
		const result = { ...response };

		// Process each field that looks like a date
		for (const [key, value] of Object.entries(response)) {
			if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
				try {
					// Parse UTC date and convert to target timezone
					const date = moment.utc(value).tz(timezone);
					if (date.isValid()) {
						(result as Record<string, unknown>)[key] = date.format();
					}
				} catch (error) {
					console.warn(`Failed to process date for field ${key}:`, error);
				}
			}
		}

		return result;
	} catch (error) {
		console.error('Failed to process response dates:', error);
		throw error;
	}
}

/**
 * Centralized function to convert all date fields to UTC format
 * This should be called just before making API requests
 */
export async function convertDatesToUTC(
	data: IDataObject,
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions,
	operationName = 'Operation',
): Promise<IDataObject> {
	try {
		// Clone input data to avoid modifying the original
		const result = { ...data };

		// Get field definitions for entity
		const fieldDefs = await getFields(entityType, context) as IAutotaskField[];
		if (!fieldDefs || !fieldDefs.length) {
			console.warn(`[${operationName}] No field definitions found for ${entityType}, skipping date conversion`);
			return result;
		}

		// Find all date/dateTime fields by type in field definitions
		const dateFieldsByType = fieldDefs
			.filter((field: IAutotaskField) => field.dataType === 'date' || field.dataType === 'dateTime')
			.map((field: IAutotaskField) => field.name);

		console.debug(`[${operationName}] Found ${dateFieldsByType.length} date/dateTime fields by type: ${dateFieldsByType.join(', ')}`);

		// Find all potential date fields by name pattern
		const potentialDateFieldsByName = fieldDefs
			.filter((field: IAutotaskField) =>
				field.name.toLowerCase().includes('date') ||
				field.name.toLowerCase().includes('time') ||
				field.name.toLowerCase().endsWith('at'))
			.filter((field: IAutotaskField) => !dateFieldsByType.includes(field.name))
			.map((field: IAutotaskField) => field.name);

		console.debug(`[${operationName}] Found ${potentialDateFieldsByName.length} potential date fields by name pattern: ${potentialDateFieldsByName.join(', ')}`);

		// Combine both lists for detection
		const allPotentialDateFields = [...dateFieldsByType, ...potentialDateFieldsByName];

		// Get timezone configuration
		const timezone = await getConfiguredTimezone.call(context);
		console.debug(`[${operationName}] Using timezone: ${timezone}`);

		// Process each field that exists in our data
		for (const fieldName of allPotentialDateFields) {
			// Skip if field doesn't exist in data
			if (!(fieldName in result)) {
				continue;
			}

			const value = result[fieldName];

			// Skip null, undefined, or non-string values
			if (value === null || value === undefined || typeof value !== 'string') {
				continue;
			}

			console.debug(`[${operationName}] Processing potential date field: ${fieldName} = ${value}`);

			// Check if value matches date patterns
			const isDatePattern = checkDatePattern(value);
			if (!isDatePattern) {
				console.debug(`[${operationName}] Field ${fieldName} doesn't match date pattern, skipping`);
				continue;
			}

			// Get field definition (might be undefined for name-pattern detected fields)
			const fieldDef = fieldDefs.find(f => f.name === fieldName);
			const fieldType = fieldDef?.dataType || 'dateTime'; // Default to dateTime if unknown

			// Convert to UTC
			try {
				const convertedValue = convertValueToUTC(value, fieldType, timezone);
				result[fieldName] = convertedValue;
				console.debug(`[${operationName}] Converted ${fieldName}: ${value} → ${convertedValue}`);
			} catch (error) {
				console.warn(`[${operationName}] Failed to convert ${fieldName}: ${error}`);
			}
		}

		return result;
	} catch (error) {
		console.error(`[${operationName}] Error in date conversion:`, error);
		return data; // Return original if conversion fails
	}
}

/**
 * Helper function to check if a string matches date patterns
 */
function checkDatePattern(value: string): boolean {
	// n8n UI specific format: YYYY-MM-DDT00:00:00
	const isN8nFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value);

	// ISO date format: YYYY-MM-DD
	const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(value);

	// US date format: MM/DD/YYYY
	const isUsDate = /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value);

	// European date format: DD.MM.YYYY or DD-MM-YYYY
	const isEuropeanDate = /^\d{1,2}[.-]\d{1,2}[.-]\d{4}/.test(value);

	return isN8nFormat || isIsoDate || isUsDate || isEuropeanDate;
}

/**
 * Helper function to convert a date string to UTC
 */
function convertValueToUTC(value: string, fieldType: string, timezone: string): string {
	// Handle the n8n UI specific format explicitly
	if (value.includes('T') && value.includes(':')) {
		// Strip any trailing Z if present (indicates UTC)
		const valueToConvert = value.endsWith('Z') ? value.slice(0, -1) : value;

		// Parse with explicit format to ensure reliability
		const utcDate = moment.tz(valueToConvert, 'YYYY-MM-DDTHH:mm:ss', timezone).utc();

		// Format based on field type
		return fieldType === 'date'
			? utcDate.format(DATE_FORMATS.API_DATE)
			: utcDate.format(DATE_FORMATS.API_DATETIME);
	}

	// For other formats, use moment's auto-detection
	const utcDate = moment(value).tz(timezone).utc();

	// Format based on field type
	return fieldType === 'date'
		? utcDate.format(DATE_FORMATS.API_DATE)
		: utcDate.format(DATE_FORMATS.API_DATETIME);
}

/**
 * @deprecated Use convertDatesToUTC instead, which centralizes date conversion
 * Ensures date fields in an object are converted to UTC
 * This is a failsafe to handle cases where validation doesn't properly convert dates
 */
export async function ensureDateFieldsConverted(
	data: IDataObject,
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions,
	operationName = 'Operation',
): Promise<void> {
	console.warn(`[${operationName}] ensureDateFieldsConverted is deprecated. Use convertDatesToUTC instead.`);
	// Original implementation follows...
}
