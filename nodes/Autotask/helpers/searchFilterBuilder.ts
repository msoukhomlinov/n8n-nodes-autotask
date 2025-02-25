import type { ISearchFilterBuilderInput } from '../types/SearchFilter';

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

function convertValue(value: string, valueType: string): string | number | boolean {
	if (valueType === 'boolean') {
		return value.toLowerCase() === 'true';
	}
	if (valueType === 'number') {
		const num = Number(value);
		if (Number.isNaN(num)) {
			throw new Error(`Invalid number value: ${value}`);
		}
		return num;
	}
	return value;
}

export function convertToAutotaskFilter(input: ISearchFilterBuilderInput): IAutotaskFilter {
	if (!input.filter?.group?.length) {
		return { filter: [] };
	}

	// Convert to Autotask API format
	const filter = input.filter.group.map((group) => {
		const items = group.items.map((item) => {
			if (item.itemType.type === 'condition') {
				const value = item.itemType.value || '';
				return {
					op: item.itemType.op,
					field: item.itemType.field,
					value: convertValue(value, item.itemType.valueType || 'string'),
					...(item.itemType.udf && { udf: true })
				} as IAutotaskFilterCondition;
			}
			if (item.itemType.type === 'group' && item.subgroup) {
				return {
					op: item.subgroup.op,
					items: item.subgroup.items
				} as IAutotaskFilterGroup;
			}
			throw new Error('Invalid filter item type or missing data');
		});

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
			if (item.itemType.type === 'condition' && item.itemType.udf) {
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
			throw new Error('Each group must contain at least one condition or subgroup');
		}

		for (const item of group.items) {
			if (item.itemType.type === 'condition') {
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
					// Validate value type conversion
					try {
						const value = item.itemType.value || '';
						convertValue(value, item.itemType.valueType || 'string');
					} catch (error) {
						throw new Error(`Value conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
					}
				}
			} else if (item.itemType.type === 'group') {
				if (!item.subgroup) {
					throw new Error('Subgroup must be defined when item type is group');
				}
			} else {
				throw new Error('Invalid item type');
			}
		}
	}
}
