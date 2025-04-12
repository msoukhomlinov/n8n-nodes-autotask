import type { INodePropertyOptions } from 'n8n-workflow';
import type { IAutotaskField } from '../../types';
import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { AUTOTASK_ENTITIES } from '../../constants/entities';
import { OperationType } from '../../types/base/entity-types';
import { EntityHelper } from '../entity/core';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';

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

/**
 * Gets a list of entities that support the QUERY operation
 * Used for dynamically populating entity dropdown in search filter operations
 */
export async function getQueryableEntities(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		// Filter entities that support query operations
		const queryableEntities = AUTOTASK_ENTITIES.filter(entity =>
			entity.operations[OperationType.QUERY] === 'self' ||
			entity.operations[OperationType.QUERY] === 'parent'
		);

		// Sort entities alphabetically by name
		const sortedEntities = queryableEntities.sort((a, b) => a.name.localeCompare(b.name));

		return sortedEntities.map(entity => ({
			name: entity.name,
			value: entity.name,
			description: `${entity.name} entity`,
		}));
	} catch (error) {
		console.error(`Error loading queryable entities: ${error instanceof Error ? error.message : 'Unknown error'}`);
		return [];
	}
}

/**
 * Gets a list of fields for a selected entity, including both standard and UDF fields
 * That are queryable for use in search filter operations
 */
export async function getEntityFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const entityType = this.getNodeParameter('entityType') as string;

		if (!entityType) {
			return [];
		}

		// Get an instance of EntityHelper for the selected entity
		const entityHelper = new EntityHelper(entityType, this);

		// Get standard fields
		const standardFields = await entityHelper.getFields({ fieldType: 'standard' });

		// Filter fields to only include queryable ones regardless of isActive value
		const queryableFields = standardFields.filter(field => field.isQueryable);

		// Get entity info to check if UDF fields are supported
		const entityInfo = await entityHelper.getEntityInfo();
		const hasUserDefinedFields = entityInfo.hasUserDefinedFields;

		// Get UDF fields if the entity supports them
		let udfFields: IUdfFieldDefinition[] = [];
		if (hasUserDefinedFields) {
			udfFields = await entityHelper.getFields({ fieldType: 'udf' }) as IUdfFieldDefinition[];
		}

		// Filter UDF fields to only include queryable ones
		const queryableUdfFields = udfFields.filter(field => field.isQueryable);

		// Manually create field options
		const standardOptions = queryableFields.map(field => ({
			name: field.label || field.name,
			value: field.name,
			description: `Type: ${field.dataType || 'unknown'}`,
		}));

		// Map UDF fields to options with UDF prefix
		const udfOptions = queryableUdfFields.map(field => ({
			name: `UDF: ${field.label || field.name}`,
			value: field.name,
			description: `UDF Type: ${field.dataType || 'unknown'}`,
		}));

		// Combine and return all options
		return [...standardOptions, ...udfOptions];
	} catch (error) {
		console.error(`Error loading entity fields: ${error instanceof Error ? error.message : 'Unknown error'}`);
		// Return empty array to avoid breaking the UI
		return [];
	}
}
