import type { UdfDataType } from './udf-types';

/**
 * Autotask API constants and limits
 */
export const API_CONSTANTS = {
	MAX_BATCH_SIZE: 500,
	MAX_PAGE_SIZE: 500,
	MAX_QUERY_LENGTH: 8000,
	MAX_FIELD_LENGTH: 128,
	MAX_DESCRIPTION_LENGTH: 2000,
	MAX_CONCURRENT_REQUESTS: 10,
} as const;

// Export types from entity-types.ts for backward compatibility
export type {
	IAutotaskEntity as Entity,
	IFilterCondition as FilterCondition,
	IFilterInput as FilterInput,
	IQueryInput as QueryInput,
	IQueryResponse as QueryResponse,
	IAutotaskCreateInput as CreateInput,
	IAutotaskEditInput as EditInput,
} from './entity-types';

// Note: All type definitions have been moved to entity-types.ts
// This file now only contains API constants and re-exports types for backward compatibility

/**
 * Union type for all possible Autotask data types
 * Includes both standard API types and UDF types
 */
export type AutotaskDataType =
	| 'integer'
	| 'string'
	| 'double'
	| 'decimal'
	| 'long'
	| 'dateTime'
	| 'date'
	| 'boolean'
	| 'options'
	| UdfDataType;  // Include UDF types
