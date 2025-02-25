import type { IFilterOptions } from '../../types/base/common';
import { EntityValueHelper } from './value-helper';
import type { IFieldMapping } from './field-mapping';
import { transformToPairs, getFieldValue } from './transformers';

/**
 * Options for retrieving entity values
 */
export interface IEntityValueOptions {
	/** Only return active entities */
	activeOnly?: boolean;
	/** Additional filters to apply */
	filters?: IFilterOptions[];
	/** Field to use for name (defaults to 'name') */
	nameField?: string;
	/** Field to use for value (defaults to 'id') */
	valueField?: string;
	/** Whether to sort results by name */
	sortByName?: boolean;
	/** Maximum depth for loading reference values */
	maxReferenceDepth?: number;
}

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

export { EntityValueHelper };
export type { IFieldMapping };
export { transformToPairs, getFieldValue };
