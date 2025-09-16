import type { IPicklistReferenceFieldMapping } from '../types/base/picklists';

/**
 * Mapping of entity types to their reference field display configuration
 */
export const PICKLIST_REFERENCE_FIELD_MAPPINGS: Record<string, IPicklistReferenceFieldMapping> = {
	'Resource': {
		nameFields: ['firstName', 'lastName'],
	},
	//'Company': {
	//	nameFields: ['companyName'],
	//},
	'Contact': {
		nameFields: ['firstName', 'lastName'],
		separator: ' ',
	},
	'Ticket': {
		nameFields: ['title'],
		bracketField: ['ticketNumber'],
	},
	'Project': {
		nameFields: ['projectName'],
		bracketField: ['projectNumber'],
	},
	'Country': {
		nameFields: ['displayName'],
	},
} as const;

/**
 * List of entities that support reference field loading
 */
export const REFERENCE_ENABLED_ENTITIES = [
	//'Company',
	'BillingCode',
	// 'Contact',
	// 'Contract',
	'Country',
	'Queue',
	'Resource',
	'ServiceLevelAgreement',
	'Status',
] as const;

export type ReferenceEnabledEntity = typeof REFERENCE_ENABLED_ENTITIES[number];

/**
 * Field display formats for various field types
 * @remarks Used to control how fields are displayed in the UI
 */
export const FIELD_DISPLAY_FORMATS = {
	/** Default display format - no special formatting */
	DEFAULT: 1,
	/** Currency display format - includes currency symbol and decimal places */
	CURRENCY: 2,
	/** Percentage display format - includes % symbol */
	PERCENTAGE: 3,
} as const;

/**
 * Standard field data types used in API responses
 * @remarks
 * These types represent the core data types available in Autotask
 * They are mapped to appropriate n8n types during field processing
 */
export const FIELD_DATA_TYPES = {
	/** Text data type for character strings */
	STRING: 'string',
	/** Numeric data type for integers and decimals */
	NUMBER: 'number',
	/** Boolean data type for true/false values */
	BOOLEAN: 'boolean',
	/** Date-only data type */
	DATE: 'date',
	/** Date and time data type */
	DATETIME: 'datetime',
	/** List data type for picklist fields */
	LIST: 'list',
} as const;

/**
 * User-defined field (UDF) data types
 * @remarks
 * UDFs use numeric type codes in the API
 * These must be converted to/from string types during processing
 */
export const UDF_DATA_TYPES = {
	/** String UDF type (type code: 1) */
	STRING: 1,
	/** Number UDF type (type code: 2) */
	NUMBER: 2,
	/** DateTime UDF type (type code: 3) */
	DATETIME: 3,
	/** Boolean UDF type (type code: 4) */
	BOOLEAN: 4,
	/** List UDF type (type code: 5) */
	LIST: 5,
} as const;

/**
 * Display formats specific to UDF fields
 * @remarks
 * These formats determine how UDF values are displayed
 */
export const UDF_DISPLAY_FORMATS = {
	/** Default format - no special formatting */
	DEFAULT: 1,
	/** Currency format - includes currency symbol */
	CURRENCY: 2,
	/** Percentage format - includes % symbol */
	PERCENTAGE: 3,
} as const;

/**
 * Default fields to use for picklist value display when no mapping exists
 * @remarks
 * These fields are used as fallback when an entity has no specific mapping
 * in PICKLIST_REFERENCE_FIELD_MAPPINGS
 */
export const DEFAULT_PICKLIST_FIELDS = ['id', 'name'] as const;

/**
 * Field type conversion mappings
 * @remarks
 * These mappings define how API field types are converted to n8n types
 * Separate mappings exist for standard fields and UDF fields
 */
export const FIELD_TYPE_MAPPINGS = {
	/**
	 * Default type mappings for standard fields
	 * @example
	 * integer -> number
	 * list -> options
	 */
	DEFAULT: {
		string: 'string',
		integer: 'number',
		long: 'number',
		decimal: 'number',
		double: 'number',
		boolean: 'boolean',
		date: 'dateTime',
		datetime: 'dateTime',
		list: 'options',
	},
	/**
	 * UDF type mappings using numeric type codes
	 * @example
	 * 1 (String) -> string
	 * 5 (List) -> options
	 */
	UDF: {
		1: 'string',   // String
		2: 'number',   // Number
		3: 'string',   // DateTime
		4: 'boolean',  // Boolean
		5: 'options',  // List
	},
} as const;

/**
 * Maps entity types to their required ID fields for update operations
 * @remarks
 * This mapping explicitly defines which ID fields are required during update operations
 * for each entity type. This prevents incorrectly marking fields as required just
 * because they end with 'id'.
 *
 * Format: {
 *   EntityName: ['requiredIdField1', 'requiredIdField2']
 * }
 */
export const REQUIRED_UPDATE_ID_FIELDS: Record<string, string[]> = {
	'Task': ['projectID'],
	'Contact': ['companyID'],
	'CompanyLocation': ['companyID'],
	'CompanyNote': ['companyID'],
	'CompanySiteConfigurations': ['companyID'],
	'ConfigurationItemNote': ['configurationItemID'],
	'ConfigurationItemRelatedItem': ['configurationItemID'],
	'ConfigurationItemDnsRecord': ['configurationItemID'],
	'ConfigurationItemCategoryUdfAssociation': ['configurationItemCategoryID'],
	'ConfigurationItemBillingProductAssociations': ['configurationItemID'],
	'ConfigurationItemSslSubjectAlternativeName': ['configurationItemID'],
	'ProjectNote': ['projectID'],
	'Phase': ['projectID'],
	'Charge': ['projectID'],
	'TicketNote': ['ticketID'],
	'TicketCharge': ['ticketID'],
	'TicketChecklistItem': ['ticketID'],
	'TicketChecklistLibrary': ['ticketID'],
	'ChecklistLibraryChecklistItem': ['checklistLibraryID'],
	'TagAlias': ['tagID'],
	'Holiday': ['holidaySetID'],
	'ContractBillingRule': ['contractID'],
	'ContractCharge': ['contractID'],
	'ContractExclusionBillingCode': ['contractID', 'billingCodeID'],
	'ContractMilestone': ['contractID'],
	'ContractNote': ['contractID'],
	'ContractService': ['contractID'],
	'ContractBlock': ['contractID'],
	'ContractBlockHourFactor': ['contractID'],
	'ContractRate': ['contractID'],
	'ContractRoleCosts': ['contractID', 'resourceID', 'roleID'],
	'ContractRetainers': ['contractID'],
	'ContractServiceAdjustment': ['contractID'],
	'ContractServiceBundleAdjustment': ['contractID'],
	'ContractServiceBundle': ['contractID'],
	'ContractExclusionRoles': ['contractID', 'roleID'],
	'ContractExclusionSetExcludedRoles': ['contractExclusionSetID'],
	'ContractExclusionSetExcludedWorkTypes': ['contractExclusionSetID'],
	'ContractTicketPurchases': ['contractID'],
	'ProductVendors': ['productID'],
	'QuoteItem': ['quoteID'],
	// Add more entities and their required ID fields as needed
} as const;
