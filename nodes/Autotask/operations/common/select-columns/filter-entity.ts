import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../../types';
import { validateJsonParameter } from '../../../helpers/json-validation';

/**
 * Filter an entity to only include selected columns
 * If no columns are selected, returns the original entity
 * If addPicklistLabels or addReferenceLabels is true, includes label fields for selected fields
 */
export function filterEntityBySelectedColumns<T extends IAutotaskEntity>(
	entity: T,
	columns: string[],
): Partial<T> {
	// If no columns selected, return the original entity
	if (!columns || !columns.length) {
		return entity;
	}

	// Log selection operation for debugging
	console.debug(`[filterEntityBySelectedColumns] Filtering entity to include ${columns.length} selected columns`);

	// Create a new object with only the selected columns
	const filteredEntity: Partial<T> = {};

	// Always include the id field for reference
	if (entity.id) {
		filteredEntity.id = entity.id;
	}

	// Add selected columns and their label fields if present
	for (const column of columns) {
		// Add the selected column if it exists in the entity
		if (column in entity) {
			filteredEntity[column as keyof T] = entity[column as keyof T];

			// Check if there's a corresponding label field (for picklist fields)
			const labelField = `${column}_label`;
			if (labelField in entity) {
				// Include the label field in the filtered entity
				filteredEntity[labelField as keyof T] = entity[labelField as keyof T];
				console.debug(`[filterEntityBySelectedColumns] Including label field: ${labelField} for selected column: ${column}`);
			}
		}
	}

	// Check for fields that end with _label and include their base field if selected
	const labelFields = Object.keys(entity).filter(key => key.endsWith('_label'));
	if (labelFields.length > 0) {
		console.debug(`[filterEntityBySelectedColumns] Found ${labelFields.length} label fields in entity`);

		for (const key of labelFields) {
			const baseField = key.replace('_label', '');
			// If the base field was selected and this label field exists, include it
			if (columns.includes(baseField) && key in entity) {
				filteredEntity[key as keyof T] = entity[key as keyof T];
				console.debug(`[filterEntityBySelectedColumns] Including label field: ${key} for selected base field: ${baseField}`);
			}
		}
	}

	return filteredEntity;
}

/**
 * Filter an array of entities to only include selected columns
 * If no columns are selected, returns the original entities
 */
export function filterEntitiesBySelectedColumns<T extends IAutotaskEntity>(
	entities: T[],
	columns: string[],
): Partial<T>[] {
	// If no columns selected, return the original entities
	if (!columns || !columns.length) {
		return entities;
	}

	// Filter each entity
	return entities.map(entity => filterEntityBySelectedColumns(entity, columns));
}

/**
 * Get selected columns from node parameters
 * Checks selectColumnsJson first, then falls back to selectColumns UI parameter
 */
export function getSelectedColumns(context: IExecuteFunctions, itemIndex: number): string[] {
	try {
		// Get resource name for validation context
		let resource: string;
		try {
			resource = context.getNodeParameter('resource', itemIndex) as string;
		} catch {
			resource = 'unknown'; // Fallback for validation context
		}

				// Check for JSON parameter first (takes precedence) - only for AI tool contexts
	try {
		// Only try to get selectColumnsJson if it's actually available
		// This parameter is intended for AI tool usage, not regular user operations
		const rawJsonParam = context.getNodeParameter('selectColumnsJson', itemIndex, []);

		// Validate JSON format and structure
		const validation = validateJsonParameter(rawJsonParam, 'selectColumnsJson', resource);
		if (!validation.isValid) {
			// If validation fails, throw the error to be caught below
			throw validation.error!;
		}

		const selectColumnsJson = validation.parsedValue as string[];
		if (selectColumnsJson.length > 0) {
			console.debug('[getSelectedColumns] Using validated selectColumnsJson parameter:', selectColumnsJson);
			return selectColumnsJson;
		}
	} catch (jsonError) {
		// JSON parameter doesn't exist or is invalid, continue to UI parameter
		console.debug('[getSelectedColumns] selectColumnsJson not available or invalid, falling back to UI parameter');
	}

		// Fall back to UI parameter
		const uiColumns = context.getNodeParameter('selectColumns', itemIndex, []) as string[];
		console.debug('[getSelectedColumns] Using selectColumns UI parameter:', uiColumns);
		return uiColumns;
	} catch (error) {
		// If it's a validation error, re-throw it
		if (error instanceof Error && (error.message.includes('selectColumnsJson') || error.message.includes('bodyJson'))) {
			throw error;
		}
		// If both parameters don't exist or there's another error, return empty array
		console.debug('[getSelectedColumns] No column selection parameters available, returning empty array');
		return [];
	}
}
