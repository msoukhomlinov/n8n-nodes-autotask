import type { EntityHelper } from './core';

/**
 * Represents a processed picklist value used throughout the application.
 * Contains field option details like display label, value, and metadata
 * about the option's status and ordering.
 */
interface IPicklistValue {
	/** The actual value stored in Autotask */
	value: string;
	/** Human-readable display text */
	label: string;
	/** Whether this is the default selection */
	isDefaultValue: boolean;
	/** Display order position (lower numbers appear first) */
	sortOrder: number;
	/** Whether this option can be selected */
	isActive: boolean;
}

/**
 * Raw picklist item structure returned by the Autotask API.
 * Matches the API response format before being transformed into IPicklistValue.
 * @see IPicklistValue for the processed version
 */
interface IPicklistApiItem {
	value: string;
	label: string;
	isDefaultValue: boolean;
	sortOrder: number;
	isActive: boolean;
}

/**
 * Raw API response structure for picklist queries.
 * Contains an array of picklist items from the Autotask API.
 */
interface IPicklistApiResponse {
	/** Array of raw picklist items from the API */
	items: IPicklistApiItem[];
}

/**
 * Retrieves picklist values for a specific field from the Autotask API.
 *
 * This function is primarily used in two contexts:
 * 1. Field mapping - To get picklist values for name and value fields when mapping entity relationships
 * 2. Entity helper - Through the EntityHelper class to fetch field options for dropdown/select fields
 *
 * @param entityType - The type of entity (e.g., 'Task', 'Project') the field belongs to
 * @param fieldName - The name of the field to get picklist values for
 * @param helper - EntityHelper instance providing context and API access
 *
 * @returns Promise resolving to an array of picklist values containing:
 *  - value: The actual value stored in Autotask
 *  - label: The human-readable display label
 *  - isDefaultValue: Whether this is the default option
 *  - sortOrder: The display order for the options
 *  - isActive: Whether the option is currently active
 *
 * @throws Error if the API request fails or returns invalid data
 *
 * @example
 * ```typescript
 * const values = await getPicklistValues('Task', 'status', entityHelper);
 * // Returns: [{ value: '1', label: 'New', isDefaultValue: true, sortOrder: 1, isActive: true }, ...]
 * ```
 */
export async function getPicklistValues(
	entityType: string,
	fieldName: string,
	helper: EntityHelper,
): Promise<IPicklistValue[]> {
	const context = helper.getContext();
	const endpoint = `/ATServicesRest/V1.0/PicklistValues/query?search={"filter":[{"op":"eq","field":"FieldID","value":"${fieldName}"}]}`;

	const response = await context.helpers.request({
		method: 'GET',
		url: endpoint,
		headers: {
			'Api-Version': '1.0',
		},
		json: true,
	}) as IPicklistApiResponse;

	return response.items.map((item: IPicklistApiItem) => ({
		value: item.value,
		label: item.label,
		isDefaultValue: item.isDefaultValue,
		sortOrder: item.sortOrder,
		isActive: item.isActive,
	}));
}
