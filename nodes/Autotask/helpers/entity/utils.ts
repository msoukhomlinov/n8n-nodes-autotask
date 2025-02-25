import { getEntityMetadata } from '../../constants/entities';
import type { WriteOperation } from '../../operations/base/types';

/**
 * Check if a field is required for a specific entity type and operation
 */
export function isFieldRequired(entityType: string, operation: WriteOperation, fieldName: string): boolean {
	const metadata = getEntityMetadata(entityType);
	if (!metadata) return false;

	// Check if field is a parent ID field
	const fieldNameLower = fieldName.toLowerCase();
	const parentType = metadata.childOf?.toLowerCase() || '';
	const isParentIdField = Boolean(parentType && fieldNameLower === `${parentType}id`);

	// For update operations, only parent ID fields are required
	if (operation === 'update') {
		return isParentIdField;
	}

	// For create operations, parent ID fields are always required
	if (operation === 'create' && isParentIdField) {
		return true;
	}

	return false;
}
