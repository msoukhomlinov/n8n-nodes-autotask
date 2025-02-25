/**
 * Constants for Autotask API filter operators
 * These operators are used to build query filters for API requests
 */

import type { FilterOperator } from '../types';

/** Available filter operators for Autotask API queries */
export const FilterOperators: { [key: string]: FilterOperator } = {
	/** Requires that the field value match the exact criteria provided */
	eq: 'eq',
	/** Requires that the field value be anything other than the criteria provided */
	noteq: 'noteq',
	/** Requires that the field value be greater than the criteria provided */
	gt: 'gt',
	/** Requires that the field value be greater than or equal to the criteria provided */
	gte: 'gte',
	/** Requires that the field value be less than the criteria provided */
	lt: 'lt',
	/** Requires that the field value be less than or equal to the criteria provided */
	lte: 'lte',
	/** Requires that the field value begin with the defined criteria */
	beginsWith: 'beginsWith',
	/** Requires that the field value end with the defined criteria */
	endsWith: 'endsWith',
	/** Allows for the string provided as criteria to match any resource that contains the string in its value */
	contains: 'contains',
	/** Enter exist to query for fields in which the data you specify is not null */
	exist: 'exist',
	/** Enter notExist to query for fields in which the specified data is null */
	notExist: 'notExist',
	/** With this value specified, the query will return only the values in the list array that match the field value you specify */
	in: 'in',
	/** With this value specified, the query will only return the values in the list array that do not match the field value you specify */
	notIn: 'notIn',
	/** Combines multiple conditions with AND logic */
	and: 'and',
} as const;
