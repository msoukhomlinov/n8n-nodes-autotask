/**
 * Represents a name/value pair for picklists/options
 */
export interface IEntityValuePair {
	/** Display name */
	name: string;
	/** Stored value */
	value: string | number;
	/** Optional description */
	description?: string;
	/** Whether this is the default value */
	isDefaultValue?: boolean;
	/** Sort order for display */
	sortOrder?: number;
	/** Whether the value is active */
	isActive?: boolean;
	/** Referenced entity type for reference fields */
	referenceEntityType?: string;
}
