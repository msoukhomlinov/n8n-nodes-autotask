/**
 * Utility functions for preparing include fields for API requests
 *
 * NOTES ON PAGINATION:
 * - The Autotask API maintains the IncludeFields parameter through pagination
 * - When a query uses IncludeFields, subsequent pagination requests will
 *   automatically receive the same fields without needing to re-specify them
 * - The nextPageUrl returned in pageDetails will preserve the IncludeFields parameter
 * - Client-side filtering is still applied as a fallback, but should not be necessary
 *   for paginated requests since the API will consistently return the same fields
 */

/**
 * Options for preparing include fields
 */
export interface IPrepareIncludeFieldsOptions {
	/** Whether to add picklist labels */
	addPicklistLabels?: boolean;
	/** Whether to add reference labels */
	addReferenceLabels?: boolean;
	/** Whether to skip validation for development/debugging */
	skipValidation?: boolean;
}

/**
 * Prepares an array of field names for the API's IncludeFields parameter
 *
 * This converts the node's selected columns to the format expected by the API,
 * handling special cases like ensuring 'id' is always included and processing
 * picklist label fields correctly.
 *
 * @param selectedColumns Array of selected column names
 * @param options Additional options for field preparation
 * @returns Array of field names formatted for the API's IncludeFields parameter
 */
export function prepareIncludeFields(
	selectedColumns: string[],
	options: IPrepareIncludeFieldsOptions = {},
): string[] {
	// If no columns selected, return empty array (API will return all fields)
	if (!selectedColumns || !selectedColumns.length) {
		return [];
	}

	// Collect base fields that need to be added for label resolution
	const extraBaseFields: string[] = [];

	// Process selected columns - filter out _label fields and track their base fields
	const includeFields = selectedColumns.filter(column => {
		// Skip label fields - these are generated client-side
		if (column.endsWith('_label')) {
			const baseField = column.replace('_label', '');
			// Handle picklist or reference labels
			if (options.addPicklistLabels || options.addReferenceLabels) {
				// Make sure the base field is included if it's not already selected
				if (!selectedColumns.includes(baseField) && !extraBaseFields.includes(baseField)) {
					extraBaseFields.push(baseField);
				}
			}
			return false;
		}

		return true;
	});

	// Append any extra base fields needed for label resolution
	for (const baseField of extraBaseFields) {
		if (!includeFields.includes(baseField)) {
			includeFields.push(baseField);
		}
	}

	// Always ensure 'id' field is included for reference
	if (!includeFields.includes('id')) {
		includeFields.push('id');
		console.debug('[prepareIncludeFields] Adding required id field');
	}

	// Log the result for debugging
	console.debug(`[prepareIncludeFields] Prepared ${includeFields.length} fields for API request`);

	return includeFields;
}
