import type { ISearchFilterBuilderInput } from '../types/SearchFilter';
import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import moment from 'moment-timezone';
import { DATE_FORMATS } from '../constants/date.constants';
import { getConfiguredTimezone } from './date-time/utils';

interface IAutotaskFilterCondition {
	op: string;
	field: string;
	value: string | number | boolean;
	udf?: boolean;
}

interface IAutotaskFilterGroup {
	op: 'and' | 'or';
	items: Array<IAutotaskFilterCondition | IAutotaskFilterGroup>;
}

interface IAutotaskFilter {
	filter: Array<IAutotaskFilterCondition | IAutotaskFilterGroup>;
}

async function convertValue(
	value: string | boolean,
	valueType: string,
	context?: IExecuteFunctions | ILoadOptionsFunctions
): Promise<string | number | boolean> {
	if (valueType === 'boolean') {
		// Handle case where value is already a boolean (from the UI toggle)
		if (typeof value === 'boolean') {
			return value;
		}
		// Handle case where value is a string (for backward compatibility)
		return value.toLowerCase() === 'true';
	}
	if (valueType === 'number') {
		const num = Number(value);
		if (Number.isNaN(num)) {
			throw new Error(`Invalid number value: ${value}`);
		}
		return num;
	}
	if (valueType === 'date') {
		try {
			// Convert value to string for date processing
			const valueStr = typeof value === 'boolean' ? value.toString() : value;

			// Get the configured timezone if context is provided
			let timezone = 'UTC';
			if (context) {
				try {
					timezone = await getConfiguredTimezone.call(context);
				} catch (error) {
					console.warn('Error getting timezone configuration, using UTC as default:', error);
				}
			}

			// Check if the value is already in ISO format or contains time components
			if (valueStr.includes('T') && valueStr.includes(':')) {
				// Strip any trailing Z if present (indicates UTC)
				const valueToConvert = valueStr.endsWith('Z') ? valueStr.slice(0, -1) : valueStr;

				// Parse with timezone context - treats input as being in the configured timezone
				const date = moment.tz(valueToConvert, timezone).utc();

				if (!date.isValid()) {
					throw new Error(`Invalid date format: ${valueStr}`);
				}

				// Return in the API_DATE format
				// Return in the API_DATETIME format to preserve time components
				return date.format(DATE_FORMATS.API_DATETIME);
			}

			// For other formats, use moment's auto-detection but with timezone context
			const date = moment.tz(valueStr, timezone).utc();

			if (!date.isValid()) {
				throw new Error(`Invalid date format: ${valueStr}`);
			}

			// Return in the API_DATE format
			return date.format(DATE_FORMATS.API_DATE);
		} catch (error) {
			throw new Error(`Invalid date value: ${value}`);
		}
	}
	// Ensure we return a string for all other cases
	return typeof value === 'boolean' ? value.toString() : value;
}

export async function convertToAutotaskFilter(
	input: ISearchFilterBuilderInput,
	context?: IExecuteFunctions | ILoadOptionsFunctions
): Promise<IAutotaskFilter> {
	if (!input.filter?.group?.length) {
		return { filter: [] };
	}

	// Convert to Autotask API format
	const filterPromises = input.filter.group.map(async (group) => {
		const itemPromises = group.items.map(async (item) => {
			const value = item.itemType.value || '';
			return {
				op: item.itemType.op,
				field: item.itemType.field,
				value: await convertValue(value, item.itemType.valueType || 'string', context),
				...(item.itemType.udf && { udf: true })
			} as IAutotaskFilterCondition;
		});

		const items = await Promise.all(itemPromises);

		// If there's only one item, return it directly
		if (items.length === 1) {
			return items[0];
		}

		// Otherwise wrap items in a group with the specified operator
		return {
			op: group.op,
			items
		} as IAutotaskFilterGroup;
	});

	const filter = await Promise.all(filterPromises);

	// If we have multiple top-level groups, wrap them in an AND group
	if (filter.length > 1) {
		return {
			filter: [{
				op: 'and',
				items: filter
			}]
		};
	}

	return { filter };
}

function countUdfConditions(input: ISearchFilterBuilderInput): number {
	let udfCount = 0;
	for (const group of input.filter?.group || []) {
		for (const item of group.items || []) {
			if (item.itemType.udf) {
				udfCount++;
			}
		}
	}
	return udfCount;
}

export function validateFilterInput(input: ISearchFilterBuilderInput): void {
	if (!input.filter?.group?.length) {
		throw new Error('Filter must contain at least one group');
	}

	const udfCount = countUdfConditions(input);
	if (udfCount > 1) {
		throw new Error('Autotask API only allows querying by one user-defined field at a time');
	}

	for (const group of input.filter.group) {
		if (!group.items?.length) {
			throw new Error('Each group must contain at least one condition');
		}

		for (const item of group.items) {
			if (!item.itemType.field) {
				throw new Error('Condition must have a field name');
			}
			if (!item.itemType.op) {
				throw new Error('Condition must have an operator');
			}
			// Only check for value if operator is not exist/notExist
			if (item.itemType.op !== 'exist' && item.itemType.op !== 'notExist') {
				if (item.itemType.value === undefined) {
					throw new Error('Condition must have a value (empty string is allowed for searching empty fields)');
				}

				// Basic validation for date values
				if (item.itemType.valueType === 'date') {
					const value = item.itemType.value || '';
					if (value !== '') {
						// Convert value to string before passing to moment
						const valueStr = typeof value === 'boolean' ? value.toString() : value;
						const date = moment(valueStr);
						if (!date.isValid()) {
							throw new Error(`Invalid date format: ${value}`);
						}
					}
				}
			}
		}
	}
}
