import type { EntityHelper } from './core';
import { getFields } from './api';
import type { IAutotaskField } from '../../types/base/entities';

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
	/** Parent value for dependent picklists (e.g., subIssueType -> issueType) */
	parentValue?: string;
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
	console.debug(`[getPicklistValues] Starting to fetch picklist values for ${entityType}.${fieldName}`);

	try {
		// Use getFields to get field definitions (with caching)
		const fields = await getFields(entityType, context, { fieldType: 'standard' }) as IAutotaskField[];
		console.debug(`[getPicklistValues] Retrieved ${fields.length} fields for ${entityType} using getFields`);

		// Find the field by name (case-insensitive)
		const field = fields.find((f) =>
			String(f.name).toLowerCase() === fieldName.toLowerCase()
		);

		if (!field) {
			console.warn(`[getPicklistValues] Field ${fieldName} not found for entity ${entityType}`);
			return [];
		}

		console.debug(`[getPicklistValues] Found field ${fieldName} for entity ${entityType}:`, {
			name: field.name,
			isPickList: field.isPickList,
			hasPicklistValues: !!field.picklistValues,
			picklistValuesCount: field.picklistValues?.length || 0
		});

		// If the field has picklistValues, use them directly
		if (field.isPickList && field.picklistValues && field.picklistValues.length > 0) {
			const picklistValues = field.picklistValues;
			console.debug(`[getPicklistValues] Using ${picklistValues.length} picklistValues from field definition for ${entityType}.${fieldName}`);

			if (picklistValues.length > 0) {
				console.debug(`[getPicklistValues] First few picklist values for ${fieldName}:`,
					picklistValues.slice(0, 3).map((item) => ({
						value: item.value,
						label: item.label
					}))
				);
			}

			return picklistValues.map((item) => ({
				value: item.value,
				label: item.label,
				isDefaultValue: item.isDefaultValue,
				sortOrder: item.sortOrder,
				isActive: item.isActive,
				parentValue: item.parentValue,
			}));
		}

		// If no picklist values found or field is not a picklist
		console.warn(`[getPicklistValues] No picklist values found for ${entityType}.${fieldName}`);
		return [];
	} catch (error) {
		console.error(`[getPicklistValues] Error fetching picklist values for ${entityType}.${fieldName}:`,
			error.message || 'Unknown error');
		// Return empty array instead of throwing to allow graceful fallback
		return [];
	}
}
