import type { INodePropertyOptions } from 'n8n-workflow';
import type { IAutotaskField } from '../../types';

/**
 * Formats field description with additional metadata
 */
function formatFieldDescription(field: IAutotaskField): string {
	const parts = [];
	if (field.description) parts.push(field.description);
	if (field.isRequired) parts.push('Required');
	if (field.isReadOnly) parts.push('Read-only');
	return parts.join(' | ');
}

/**
 * Gets field options for an entity
 */
export function getFieldOptions(fields: IAutotaskField[]): INodePropertyOptions[] {
	try {
		return fields
			.filter(field => field.isActive)
			.map(field => ({
				name: field.label || field.name,
				value: field.name,
				description: formatFieldDescription(field),
			}));
	} catch (error) {
		throw new Error(`Failed to get field options: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

/**
 * Gets filter field options for an entity
 */
export function getFilterFieldOptions(fields: IAutotaskField[]): INodePropertyOptions[] {
	try {
		return fields
			.filter(field => field.isActive && field.isQueryable)
			.map(field => ({
				name: field.label || field.name,
				value: field.name,
				description: formatFieldDescription(field),
			}));
	} catch (error) {
		throw new Error(`Failed to get filter field options: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

/**
 * Gets sort field options for an entity
 */
export function getSortFieldOptions(fields: IAutotaskField[]): INodePropertyOptions[] {
	try {
		return fields
			.filter(field => field.isActive && field.isQueryable)
			.map(field => ({
				name: field.label || field.name,
				value: field.name,
				description: formatFieldDescription(field),
			}));
	} catch (error) {
		throw new Error(`Failed to get sort field options: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}
