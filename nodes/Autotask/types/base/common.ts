import type { OperationType } from './entity-types';

export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ResourceOperation = OperationType;

export interface IPaginationOptions {
	pageSize?: number;
	maxItems?: number;
}

export type FilterOperator = 'eq' | 'noteq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'beginsWith' | 'endsWith' | 'exist' | 'notExist' | 'in' | 'notIn' | 'and';

export interface IFilterOptions {
	field: string;
	operator: string;
	value: string | number | boolean | null;
	udf?: boolean;  // Indicates if the field is a User Defined Field
}

export interface ISortOptions {
	field: string;
	direction: 'ASC' | 'DESC';
}

export interface IQueryOptions {
	filters?: IFilterOptions[];
	sort?: ISortOptions[];
	fields?: string[];
	expand?: string[];
	pagination?: IPaginationOptions;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject extends Record<string, JsonValue> {}
export interface JsonArray extends Array<JsonValue> {}

/**
 * Base interface for all validation contexts
 */
export interface IBaseValidation {
	/** The type of entity being validated */
	entityType: string;
	/** Optional additional context */
	context?: Record<string, unknown>;
}

/**
 * Base validation rules that apply to all fields
 * These are the core validation properties that every field must implement
 */
export interface IBaseValidationRules {
	/** Whether the field is required */
	isRequired: boolean;
	/** Whether the field is read-only */
	isReadOnly: boolean;
	/** Maximum length for string fields */
	length?: number;
}

/**
 * Extended validation rules for regular fields
 * Includes all base validation plus field-specific capabilities
 */
export interface IFieldValidationRules extends IBaseValidationRules {
	/** Whether the field can be used in queries */
	isQueryable: boolean;
	/** Minimum value for numeric fields */
	min?: number;
	/** Maximum value for numeric fields */
	max?: number;
	/** Regular expression pattern for string fields */
	pattern?: string;
}

/**
 * Extended validation rules for User Defined Fields (UDFs)
 * Includes all field validation plus UDF-specific features
 */
export interface IUdfValidationRules extends IFieldValidationRules {
	/** Custom validation expression */
	customValidation?: string;
	/** Fields that this field depends on */
	dependentFields?: string[];
}

// Deprecate old IValidationRules interface but keep for backward compatibility
/** @deprecated Use IFieldValidationRules instead */
export interface IValidationRules extends Partial<IFieldValidationRules> {}

/**
 * Result of value validation
 */
export interface IValidationResult {
	/** Whether the value is valid */
	isValid: boolean;
	/** List of validation error messages */
	errors: string[];
}

/**
 * Context for query validation
 */
export interface IValidationContext extends IBaseValidation {
	/** Whether the entity is a VB entity (affects UDF limits) */
	isVBEntity?: boolean;
}

/**
 * Validation error details
 */
export interface IValidationError {
	/** Error message */
	message: string;
	/** Error code for programmatic handling */
	code: string;
	/** Optional additional context */
	context?: unknown;
}

