/**
 * Interface for picklist values
 */
export interface IPicklistValue {
	/** The value stored in the database */
	value: string;
	/** The display label shown to users */
	label: string;
	/** Whether this is the default value */
	isDefaultValue: boolean;
	/** Sort order for display */
	sortOrder: number;
	/** Whether the value is active */
	isActive: boolean;
	/** Whether this is a system value */
	isSystem: boolean;
	/** Parent value for dependent picklists */
	parentValue?: string;
}

/**
 * Interface for configuring how reference field values should be displayed in picklists
 * Used when an entity doesn't have a simple 'name' field and needs to combine multiple fields
 */
export interface IPicklistReferenceFieldMapping {
	/**
	 * Array of field names to combine for display
	 * e.g., ['firstName', 'lastName'] for Resources
	 */
	nameFields: string[];

	/**
	 * Optional separator to use between combined fields
	 * Defaults to single space if not specified
	 */
	separator?: string;

	/**
	 * Optional field to use for the value
	 * Defaults to 'id' if not specified
	 */
	valueField?: string;

	/**
	 * Optional field(s) to display in round brackets at the end
	 * Can be a single field name or an array of field names
	 * Multiple fields will be comma-separated in display
	 * e.g., "John Smith (john@email.com)" for single field
	 * e.g., "Company Name (ID123, Branch456)" for multiple fields
	 */
	bracketField?: string | string[];

	/**
	 * Optional default filters to apply when loading reference values
	 * Key-value pairs where key is the field name and value is the filter value
	 * e.g., { isActive: true } to only show active resources
	 */
	filters?: Record<string, unknown>;
}
