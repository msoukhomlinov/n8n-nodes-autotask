import type { IDataObject } from 'n8n-workflow';
import type { IPicklistValue } from './picklists';
import type { IFieldValidationRules } from './common';
import type { IEntityMetadata, ResourceMapperField } from './entities';

export type { IEntityMetadata, ResourceMapperField };

/**
 * Operation types supported by Autotask entities
 */
export enum OperationType {
	CREATE = 'create',
	READ = 'read',
	UPDATE = 'update',
	DELETE = 'delete',
	QUERY = 'query',
	COUNT = 'count',
	GET_ENTITY_INFO = 'getEntityInfo',
	GET_FIELD_INFO = 'getFieldInfo',
}

/**
 * Operation context for entity operations
 */
export type OperationContext = 'parent' | 'self';

// Constants for API limits
const MAX_OR_CONDITIONS = 500;
const MAX_UDF_PER_QUERY = 1;

/**
 * Base interface for all Autotask entities
 */
export interface IAutotaskEntity extends IDataObject {
	id?: number;
	userDefinedFields?: Record<string, unknown>;
	createDate?: string;
	lastModifiedDate?: string;
}

/**
 * Data type definitions for Autotask fields
 */
export type AutotaskDataType = 'string' | 'integer' | 'double' | 'decimal' | 'long' | 'boolean' | 'dateTime' | 'date' | 'options';

/**
 * Base interface for all Autotask fields
 * Implements IFieldValidationRules for consistent validation across the system
 */
export interface IAutotaskField extends IFieldValidationRules {
	/** Field name */
	name: string;
	/** Display label */
	label: string;
	/** Field data type */
	dataType: AutotaskDataType;
	/** Maximum length for string fields */
	length?: number;
	/** Whether the field is required */
	isRequired: boolean;
	/** Whether the field is read-only */
	isReadOnly: boolean;
	/** Whether the field can be used in queries */
	isQueryable: boolean;
	/** Field description */
	description: string | null;
	/** Whether the field is a picklist */
	isPickList: boolean;
	/** Whether the field is a reference to another entity */
	isReference: boolean;
	/** Whether the field is supported in webhooks */
	isSupportedWebhookField: boolean;
	/** Picklist values for option fields */
	picklistValues?: IPicklistValue[];
	/** Parent field for dependent picklists */
	picklistParentField?: string;
	/** Default value */
	defaultValue?: unknown;
	/** Whether the field is active */
	isActive: boolean;
	/** Whether this is a system field */
	isSystemField: boolean;
	/** Referenced entity type for reference fields */
	referenceEntityType?: string;
	/** Creation date */
	createDate?: string;
	/** Last modification date */
	lastModifiedDate?: string;
}

/**
 * Filter condition for queries
 */
export interface IFilterCondition {
	field?: string;
	op: string;
	value?: string | number | boolean | null;
	udf?: boolean;
	items?: IFilterCondition[];
}

/**
 * Filter input for queries
 * The filter property is required and must be an array (empty array is valid)
 */
export interface IFilterInput {
	filter: IFilterCondition[];
}

/**
 * Pagination details
 */
export interface IPageDetails {
	count: number;
	requestCount: number;
	prevPageUrl: string | null;
	nextPageUrl: string | null;
}

/**
 * Query input parameters
 */
export interface IQueryInput extends IFilterInput {
	IncludeFields?: string[];
	MaxRecords?: number;
}

/**
 * Query response
 */
export interface IQueryResponse<T> {
	items: T[];
	pageDetails: IPageDetails;
}

/**
 * Type for creating a new entity
 */
export type IAutotaskCreateInput<T extends IAutotaskEntity> = Omit<T, 'id' | 'createDate' | 'lastModifiedDate'>;

/**
 * Type for updating an existing entity
 */
export type IAutotaskEditInput<T extends IAutotaskEntity> = {
	id: number;
} & Partial<Omit<T, 'id' | 'createDate' | 'lastModifiedDate'>>;

/**
 * Type for filtering entities
 */
export type IAutotaskFilterInput<T extends IAutotaskEntity> = IFilterInput & {
	maxResults?: number;
	maxOrConditions?: typeof MAX_OR_CONDITIONS;
	maxUdfPerQuery?: typeof MAX_UDF_PER_QUERY;
	entityType?: T['id'] extends number ? string : never;
};

/**
 * Type for querying entities
 */
export type IAutotaskQueryInput<T extends IAutotaskEntity> = IQueryInput & {
	returnAll?: boolean;
	entityType?: T['id'] extends number ? string : never;
};

/**
 * Type for query responses
 */
export type IAutotaskQueryResponse<T extends IAutotaskEntity> = IQueryResponse<T>;

/**
 * Entity information from the API
 */
export interface IEntityInfo {
	/** Entity name */
	name: string;
	/** Display label */
	label: string;
	/** Entity description */
	description: string | null;
	/** Whether the entity is active */
	isActive: boolean;
	/** Whether this is a system entity */
	isSystemEntity: boolean;
	/** Creation date */
	createDate?: string;
	/** Last modification date */
	lastModifiedDate?: string;
}

