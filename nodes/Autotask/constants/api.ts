/**
 * Centralized API-related constants for the Autotask integration
 */

/** API Version */
export const API_VERSION = {
	/** Current version of the Autotask REST API */
	VERSION: 'v1.0',
} as const;

/** API constants and limits */
export const API_CONSTANTS = {
	/** Maximum batch size for API operations */
	MAX_BATCH_SIZE: 500,
	/** Maximum page size for paginated results */
	MAX_PAGE_SIZE: 500,
	/** Maximum length of query strings */
	MAX_QUERY_LENGTH: 8000,
	/** Maximum length of field values */
	MAX_FIELD_LENGTH: 128,
	/** Maximum length of description fields */
	MAX_DESCRIPTION_LENGTH: 2000,
	/** Maximum number of concurrent API requests */
	MAX_CONCURRENT_REQUESTS: 10,
	/** Maximum number of OR conditions in a query */
	MAX_OR_CONDITIONS: 500,
	/** Maximum number of UDFs per query */
	MAX_UDF_PER_QUERY: 1,
	/** Maximum length of GET request URLs */
	MAX_GET_LENGTH: 2048,
	/** Maximum number of API requests per hour */
	MAX_REQUESTS_PER_HOUR: 10000,
} as const;

/** Pagination limits */
export const PAGINATION = {
	/** Maximum number of items per page */
	MAX_PAGE_SIZE: 500,
	/** Minimum number of items per page */
	MIN_PAGE_SIZE: 1,
	/** Default number of items per page if not specified */
	DEFAULT_PAGE_SIZE: 10,
	/** Maximum number of pages that can be tracked for pagination */
	MAX_PAGES: 1000,
} as const;

/** Available filter operators for Autotask API queries */
export const FILTER_OPERATORS = {
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
} as const;

/** Available write operations */
export const WRITE_OPERATIONS = ['create', 'update', 'delete'] as const;

/** Available read operations */
export const READ_OPERATIONS = ['get', 'getMany', 'count'] as const;

/** Operation types */
export const OPERATION_TYPES = {
	READ: 'read',
	WRITE: 'write',
	QUERY: 'query',
} as const;

/** API endpoint types */
export const ENDPOINT_TYPES = {
	ENTITY_INFORMATION: 'entityInformation',
	QUERY: 'query',
	FIELDS: 'fields',
	UDF_FIELDS: 'userDefinedFields',
} as const;
