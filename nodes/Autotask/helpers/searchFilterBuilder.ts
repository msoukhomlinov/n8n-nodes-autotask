import type { ISearchFilterBuilderInput } from '../types/SearchFilter';
import moment from 'moment-timezone';

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

function convertValue(
	value: string | boolean,
	valueType: string,
): string | number | boolean {
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
			// The value is already an ISO string from the dateTime input.
			// The API should handle the timezone offset correctly.
			// No conversion is needed here.
			return typeof value === 'boolean' ? value.toString() : value;
		} catch (error) {
			throw new Error(`Invalid date value: ${value}`);
		}
	}
	// Ensure we return a string for all other cases
	return typeof value === 'boolean' ? value.toString() : value;
}

export async function convertToAutotaskFilter(
	input: ISearchFilterBuilderInput,
): Promise<IAutotaskFilter> {
	if (!input.filter?.group?.length) {
		return { filter: [] };
	}

	// Convert to Autotask API format
	const filterPromises = input.filter.group.map(async (group) => {
		const items = group.items.map((item) => {
			const value = item.itemType.value || '';
			return {
				op: item.itemType.op,
				field: item.itemType.field,
				value: convertValue(value, item.itemType.valueType || 'string'),
				...(item.itemType.udf && { udf: true }),
			} as IAutotaskFilterCondition;
		});

		// If there's only one item, return it directly
		if (items.length === 1) {
			return items[0];
		}

		// Otherwise wrap items in a group with the specified operator
		return {
			op: group.op,
			items,
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
