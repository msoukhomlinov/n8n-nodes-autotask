import type { ReferenceEnabledEntity } from '../../constants/field.constants';
import type { IBaseField, IPicklistField, IResourceMapperField } from './field-base';
import type { AutotaskDataType } from './core-types';
import type { OperationType, OperationContext } from './entity-types';

/**
 * Required fields configuration for an operation
 */
export interface IRequiredFieldsConfig {
	[key: string]: string[] | undefined;
}

/**
 * Child resource metadata
 */
export interface IChildResource {
	/** Resource name */
	name: string;
	/** Supported operations */
	operations: OperationType[];
	/** Alternative name used in URLs */
	subname: string;
	/** Parent chain for nested resources */
	parentChain?: string[];
	/** Whether this is an attachment resource */
	isAttachment?: boolean;
}

/**
 * Metadata about an Autotask entity
 * Basic entity information with optional parent-child relationship properties
 */
export interface IEntityMetadata {
	/** Entity name */
	name: string;
	/** Parent entity type for child resources */
	childOf?: string;
	/** Alternative name used in URLs */
	subname?: string;
	/** Parent ID field name (e.g., 'companyID' for Company parent) */
	parentIdField?: string;
	/** Operation contexts for different operation types */
	operations: {
		[key in OperationType]?: OperationContext;
	};
	/** Parent chain for nested resources */
	parentChain?: string[];
	/** Whether this is an attachment entity requiring special handling */
	isAttachment?: boolean;
	/** Whether this entity supports User Defined Fields */
	hasUserDefinedFields?: boolean;
	/** Whether this entity supports webhook callouts */
	supportsWebhookCallouts?: boolean;
	/** @deprecated Use top-level entity definitions instead */
	childResources?: IChildResource[];
}

/**
 * Raw field information from Autotask API
 * Maps exactly to the API response structure
 */
export interface IAutotaskField extends IBaseField {
	dataType: AutotaskDataType;
	length?: number;                // For string datatypes, max allowed characters
	isReference: boolean;           // True if contains ID of another entity
	referenceEntityType?: ReferenceEnabledEntity | string;   // Entity type of the reference if isReference=true
	isPickList: boolean;            // True if field is a picklist/dropdown
	picklistValues?: IPicklistField['picklistValues'];  // Use picklist values from base interface
	picklistParentValueField?: string;  // Parent field name if picklist depends on another field
}

/**
 * Enhanced field information for n8n UI
 * Extends the API field with UI-specific properties
 */
export interface IEntityField extends IAutotaskField {
	// UDF-specific properties
	isUdf?: boolean;               // True if field is a User Defined Field
	udfType?: number;              // UDF type if applicable
	displayFormat?: number;         // Display format for UDF fields
	isEncrypted?: boolean;         // True if UDF field is encrypted
	isPrivate?: boolean;           // True if UDF field is private
	isProtected?: boolean;         // True if UDF field is protected
	numberOfDecimalPlaces?: number; // Decimal places for numeric UDF fields
	loadError?: string; // Error message when loading reference values fails
}

/**
 * Entity information including fields and capabilities
 * Maps to Autotask REST API's InfoResponse type
 */
export interface IEntityInfo {
	name: string;
	label: string;
	fields: IAutotaskField[];       // Using raw API field type
	canCreate: boolean;
	canUpdate: boolean;
	canDelete: boolean;
	canQuery: boolean;
	hasUserDefinedFields: boolean;
	supportsWebhookCallouts: boolean;
	userAccessForCreate: 'None' | 'All' | 'Restricted';
	userAccessForDelete: 'None' | 'All' | 'Restricted';
	userAccessForQuery: 'None' | 'All' | 'Restricted';
	userAccessForUpdate: 'None' | 'All' | 'Restricted';
}

/**
 * Resource mapper field for n8n UI
 * Extends the base resource mapper field interface
 */
export interface ResourceMapperField extends IResourceMapperField {
	// Whether n8n should pre-select the field as a matching field
	defaultMatch: boolean;

	// Whether the field can be used as a matching field
	canBeUsedToMatch?: boolean;

	// Added at runtime if the field is removed from mapping by the user
	removed?: boolean;
}

// Remove duplicate type guards since they're now in field-base.ts

