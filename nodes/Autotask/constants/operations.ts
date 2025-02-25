/** Constants and limitations for the Autotask REST API operations */

/** API Version */
export const API_VERSION = {
	/** Current version of the Autotask REST API */
	VERSION: 'v1.0',
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
	MAX_PAGES: 50,
} as const;

/** Query limitations */
export const QUERY_LIMITS = {
	/** Maximum number of filter conditions in a single query */
	MAX_FILTER_CONDITIONS: 8,
	/** Maximum number of fields in includeFields parameter */
	MAX_INCLUDE_FIELDS: 25,
	/** Maximum length of filter values */
	MAX_FILTER_VALUE_LENGTH: 250,
	/** Maximum number of values in an 'in' operator filter */
	MAX_IN_CLAUSE_VALUES: 50,
	/** Maximum number of UDF fields that can be used in filters per query */
	MAX_UDF_FILTER_FIELDS: 1,
	/** Maximum number of OR conditions in a single API call */
	MAX_OR_CONDITIONS: 500,
} as const;

/** Query requirements */
export const QUERY_REQUIREMENTS = {
	/** ID field must be included in IncludeFields when results exceed MAX_PAGE_SIZE */
	REQUIRE_ID_FIELD_OVER_MAX_PAGE: true,
} as const;

/** Date format patterns */
export const DATE_FORMATS = {
	/** API date format (ISO 8601) */
	API_DATE: 'YYYY-MM-DD',
	/** API datetime format (ISO 8601) with timezone */
	API_DATETIME: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
	/** Default timezone */
	TIMEZONE: 'UTC',
} as const;
