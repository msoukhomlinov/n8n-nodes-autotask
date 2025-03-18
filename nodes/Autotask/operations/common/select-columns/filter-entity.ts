import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../../types';

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

		labelFields.forEach(key => {
			const baseField = key.replace('_label', '');
			// If the base field was selected and this label field exists, include it
			if (columns.includes(baseField) && key in entity) {
				filteredEntity[key as keyof T] = entity[key as keyof T];
				console.debug(`[filterEntityBySelectedColumns] Including label field: ${key} for selected base field: ${baseField}`);
			}
		});
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
 */
export function getSelectedColumns(context: IExecuteFunctions, itemIndex: number): string[] {
	try {
		return context.getNodeParameter('selectColumns', itemIndex, []) as string[];
	} catch (error) {
		// If parameter doesn't exist or there's an error, return empty array
		return [];
	}
}
