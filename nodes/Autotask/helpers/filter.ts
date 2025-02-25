import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../types';
import { FilterOperators } from '../constants/filters';

/**
 * Type for field mappings from resource mapper
 */
interface IResourceMapperFields {
	value: { [key: string]: string | number };
}

/**
 * Get field mappings from resource mapper
 */
function getResourceMapperFields(context: IExecuteFunctions, itemIndex: number): IResourceMapperFields {
	return context.getNodeParameter('fieldsToMap', itemIndex) as IResourceMapperFields;
}

/**
 * Convert field mappings to filter format
 */
function convertFieldsToFilters<T extends IAutotaskEntity>(
	fields: IResourceMapperFields,
): IAutotaskQueryInput<T>['filter'] {
	const filters: IAutotaskQueryInput<T>['filter'] = [];

	if (fields?.value) {
		for (const [field, value] of Object.entries(fields.value)) {
			if (value !== undefined && value !== '') {
				filters.push({
					field,
					value,
					op: 'eq', // Use equals operator for field matching
				});
			}
		}
	}

	return filters;
}

/**
 * Finalize resource mapper filters by combining multiple fields with AND logic
 * If no filters exist, applies the default filter
 */
function finalizeResourceMapperFilters<T extends IAutotaskEntity>(
	filters: IAutotaskQueryInput<T>['filter'],
	defaultFilter?: { field: string; op: string },
): IAutotaskQueryInput<T>['filter'] {
	// If we have multiple filters, combine them with AND logic
	if (filters.length > 1) {
		return [{
			op: FilterOperators.and,
			items: filters,
		}];
	}

	// If we have exactly one filter, return it as is
	if (filters.length === 1) {
		return filters;
	}

	// No filters - use default filter
	if (defaultFilter) {
		return [defaultFilter];
	}

	// Fallback to id exists
	return [{
		field: 'id',
		op: FilterOperators.exist,
	}];
}

/**
 * Build filters array from resource mapper fields
 * Multiple fields are automatically combined with AND logic
 */
export function buildFiltersFromResourceMapper<T extends IAutotaskEntity>(
	context: IExecuteFunctions,
	itemIndex: number,
	defaultFilter?: { field: string; op: string },
): IAutotaskQueryInput<T>['filter'] {
	const fields = getResourceMapperFields(context, itemIndex);
	const filters = convertFieldsToFilters<T>(fields);
	return finalizeResourceMapperFilters<T>(filters, defaultFilter);
}

/**
 * Build a filter query string from node parameters
 */
export function buildFilterQuery<T extends IAutotaskEntity>(
	context: IExecuteFunctions,
	itemIndex: number,
	defaultFilter?: { field: string; op: string },
): string {
	const filters = buildFiltersFromResourceMapper<T>(context, itemIndex, defaultFilter);
	return JSON.stringify({ filter: filters });
}
