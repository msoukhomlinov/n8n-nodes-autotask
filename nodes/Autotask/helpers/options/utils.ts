import type { INodePropertyOptions } from 'n8n-workflow';
import type { IAutotaskField, IFieldValidationRules } from '../../types';

type FieldWithValidation = IAutotaskField & {
	validation: IFieldValidationRules;
	id: number | string;
};

/**
 * Sort fields by required status and name
 */
export function sortFieldsByRequiredAndName(fields: FieldWithValidation[]): INodePropertyOptions[] {
	try {
		return fields.sort((a, b) => {
			// Sort by required status first
			if (a.validation.isRequired && !b.validation.isRequired) {
				return -1;
			}
			if (!a.validation.isRequired && b.validation.isRequired) {
				return 1;
			}

			// Then sort by name
			const nameA = a.name.toLowerCase();
			const nameB = b.name.toLowerCase();
			if (nameA < nameB) {
				return -1;
			}
			if (nameA > nameB) {
				return 1;
			}
			return 0;
		}).map(field => ({
			name: field.name,
			value: field.id.toString(),
			description: formatFieldDescription(field),
		}));
	} catch (error) {
		console.error('Failed to sort fields:', error);
		throw error;
	}
}

/**
 * Format field description for display
 */
export function formatFieldDescription(field: FieldWithValidation): string {
	const parts = [];

	// Add field type
	parts.push(`Type: ${field.dataType}`);

	// Add required status
	if (field.validation.isRequired) {
		parts.push('Required');
	}

	// Add read-only status
	if (field.validation.isReadOnly) {
		parts.push('Read-only');
	}

	// Add field description if available
	if (field.description) {
		parts.push(field.description);
	}

	return parts.join(' | ');
}
