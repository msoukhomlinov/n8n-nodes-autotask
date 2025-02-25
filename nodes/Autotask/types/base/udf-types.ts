import type { AutotaskDataType } from './core-types';
import type { IUdfBaseField, IPicklistField, IResourceMapperField } from './field-base';

/**
 * UDF Field Definition as per Autotask API
 */
export interface IUdfFieldDefinition extends IUdfBaseField {
	crmToProjectUdfId?: number;      // long
	defaultValue?: string;           // string(1024)
	mergeVariableName?: string;      // string(100)
	isPickList?: boolean;            // True if field is a picklist/dropdown
	picklistValues?: IPicklistField['picklistValues']; // Use picklist values from base interface
}

/**
 * UDF List Item as per Autotask API
 */
export interface IUdfFieldListItem {
	id: number;                      // long, read-only, required
	createDate: string;              // datetime, read-only
	isActive: boolean;               // boolean
	udfFieldId: number;              // long, required, references UserDefinedFieldDefinitions
	valueForDisplay: string;         // string(128), required
	valueForExport: string;          // string(128), required
}

/**
 * UDF Data Types
 */
export enum UdfDataType {
	String = 1,
	Number = 2,
	DateTime = 3,
	Boolean = 4,
	List = 5,
}

/**
 * UDF Types
 */
export enum UdfType {
	Standard = 1,
	Encrypted = 2,
	FieldMapping = 3,
}

/**
 * UDF Display Formats
 */
export enum UdfDisplayFormat {
	Default = 1,
	Currency = 2,
	Percentage = 3,
}

/**
 * UDF value container with type information
 */
export interface IUdfValue<T = unknown> {
	fieldId: number;
	name: string;
	value: T;
	dataType: AutotaskDataType;
	isValid: boolean;
	validationErrors?: string[];
}

/**
 * UDF configuration for n8n UI
 * Extends the base resource mapper field interface
 */
export interface IUdfResourceMapperField extends IResourceMapperField {
	// UDF-specific properties
	udfType: number;
	displayFormat?: number;
	isEncrypted: boolean;
	isFieldMapping: boolean;
	isPrivate: boolean;
	isProtected: boolean;
	isVisibleToClientPortal: boolean;
	numberOfDecimalPlaces?: number;
}

/**
 * UDF search/query parameters
 */
export interface IUdfQueryParams {
	dataType?: AutotaskDataType;
	isActive?: boolean;
	isRequired?: boolean;
	isQueryable?: boolean;
	name?: string;
	label?: string;
	includeInactive?: boolean;
	maxResults?: number;
	sortBy?: 'name' | 'label' | 'dataType' | 'sortOrder';
	sortDirection?: 'asc' | 'desc';
}
