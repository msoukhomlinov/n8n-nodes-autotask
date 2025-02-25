/**
 * Autotask Node Type Definitions
 *
 * This file exports all types needed for the Autotask node implementation.
 * Types are organized by functionality and follow n8n's naming conventions.
 */

import type {
	IAutotaskEntity,
	IAutotaskField,
	IAutotaskCreateInput,
	IAutotaskEditInput,
	IAutotaskQueryInput,
	IAutotaskQueryResponse,
} from './base/entity-types';
import type { IPicklistValue } from './base/picklists';
import type { IValidationResult } from './base/common';

// -----------------------------------------------------------------------------
// Entity Types
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// API Communication Types
// -----------------------------------------------------------------------------

/**
 * Types for API requests, responses, and authentication
 */
export type {
	// API Core
	IAutotaskResponse,
	IApiError,
	IApiQueryParams,
} from './base/api';

export type {
	// HTTP
	IRequestConfig,
	IRequestOptions,
	IHttpResponse,
	HttpMethod,
} from './base/http';

export type {
	// Authentication
	IAutotaskCredentials,
	IAuthHeaders,
	ICredentialsConfig,
} from './base/auth';

// -----------------------------------------------------------------------------
// Entity and Field Types
// -----------------------------------------------------------------------------

/**
 * Core entity types and operations
 * @example
 * ```typescript
 * // Creating a new entity
 * const input: IEntityCreateInput<Account> = {
 *   name: 'New Account',
 *   type: 'Customer'
 * };
 * ```
 */
export type {
	// Base Types
	IAutotaskEntity,
	IAutotaskField,
	AutotaskDataType,
	IEntityInfo,
	IEntityMetadata,

	// Query and Filter
	IFilterCondition,
	IFilterInput,
	IPageDetails,
	IQueryInput,
	IQueryResponse,

	// CRUD Operations
	IAutotaskCreateInput,
	IAutotaskEditInput,
	IAutotaskFilterInput,
	IAutotaskQueryInput,
	IAutotaskQueryResponse,
} from './base/entity-types';

/**
 * Field types and picklist handling
 * @example
 * ```typescript
 * // Defining a picklist field
 * const field: IFieldMetadata = {
 *   name: 'status',
 *   label: 'Status',
 *   dataType: 'options',
 *   picklistValues: [
 *     { value: 'active', label: 'Active' }
 *   ]
 * };
 * ```
 */
export type {
	IPicklistValue,
	IPicklistReferenceFieldMapping,
} from './base/picklists';

// -----------------------------------------------------------------------------
// Validation and Error Types
// -----------------------------------------------------------------------------

/**
 * Types for validation and error handling
 * @example
 * ```typescript
 * // Validating a field value
 * const result: IValidationOutcome = {
 *   isValid: true,
 *   errors: []
 * };
 * ```
 */
export type {
	// Common Types
	FilterOperator,
	ResourceOperation,
	IQueryOptions,
	IFilterOptions,
	ISortOptions,
	IFieldValidationRules,

	// Validation
	IValidationRules,
	IValidationResult,
	IValidationContext,
	IValidationError,
} from './base/common';

export type {
	// Error Types
	AutotaskZoneError,
	ErrorCode,
} from './base/errors';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * API constants and limits
 */
export { API_CONSTANTS } from './base/core-types';

// -----------------------------------------------------------------------------
// Type Aliases for Common Use Cases
// -----------------------------------------------------------------------------

/**
 * Convenient type aliases for common operations
 *
 * Naming Convention:
 * - Interface exports keep 'I' prefix to match n8n convention
 * - Type aliases should be clear about their purpose and relationship to base types
 */

// Entity operations
export type IEntityCreateInput<T extends IAutotaskEntity> = IAutotaskCreateInput<T>;
export type IEntityUpdateInput<T extends IAutotaskEntity> = IAutotaskEditInput<T>;
export type IEntityQueryInput<T extends IAutotaskEntity> = IAutotaskQueryInput<T>;
export type IEntityQueryResponse<T extends IAutotaskEntity> = IAutotaskQueryResponse<T>;

// Field types
export type IFieldMetadata = IAutotaskField;
export type IPicklistOptionValue = IPicklistValue;

// Validation
export type IValidationOutcome = IValidationResult;

