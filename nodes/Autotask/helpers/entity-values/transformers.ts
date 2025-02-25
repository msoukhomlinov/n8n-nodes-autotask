import type { Entity } from '../../types/base/core-types';
import type { IEntityValuePair } from '../../types/base/entity-values';
import type { EntityHelper } from '../entity/core';
import type { IAutotaskField } from '../../types/base/entity-types';
import { getReferenceValues } from './helpers';

/**
 * Type guard to check if a field is an IAutotaskField
 */
function isAutotaskField(field: unknown): field is IAutotaskField {
	return field !== undefined && (field as IAutotaskField).isReference !== undefined;
}

/**
 * Get value from entity field
 */
export function getFieldValue(
	entity: Entity,
	field: string,
): unknown {
	const parts = field.split('.');
	let value: unknown = entity;

	for (const part of parts) {
		if (value === null || value === undefined || typeof value !== 'object') {
			return undefined;
		}
		value = (value as Record<string, unknown>)[part];
	}

	return value;
}

/**
 * Transform entities into name/value pairs
 * @param entities - The entities to transform
 * @param mapping - Configuration for field mapping
 * @param mapping.nameFields - Fields to combine for display name
 * @param mapping.valueField - Field to use for value
 * @param mapping.separator - Separator to use between name fields
 * @param mapping.bracketField - Optional field to display in brackets
 * @param maxReferenceDepth - Maximum depth for resolving reference values
 * @param entityHelper - Helper for accessing entity information
 * @returns Promise resolving to array of entity value pairs
 */
export async function transformToPairs(
	entities: Entity[],
	mapping: {
		nameFields: string[];
		valueField: string;
		separator: string;
		bracketField?: string;
	},
	maxReferenceDepth: number,
	entityHelper: EntityHelper,
): Promise<IEntityValuePair[]> {
	// Get field info
	const fields = await entityHelper.getFields();
	const nameFieldInfos = mapping.nameFields.map(field => fields.find(f => f.name === field));
	const valueFieldInfo = fields.find(f => f.name === mapping.valueField);
	const bracketFieldInfo = mapping.bracketField ? fields.find(f => f.name === mapping.bracketField) : undefined;

	// Transform each entity
	const transformResults = await Promise.all(
		entities.map(async entity => {
			try {
				// Get name parts
				const nameParts = await Promise.all(
					nameFieldInfos.map(async (fieldInfo, index) => {
						if (!fieldInfo) return '';

						const value = getFieldValue(entity, mapping.nameFields[index]);
						if (value === null || value === undefined) return '';

						// Handle reference fields
						if (isAutotaskField(fieldInfo) && fieldInfo.isReference && fieldInfo.referenceEntityType) {
							const referenceValues = await getReferenceValues(
								fieldInfo.referenceEntityType,
								entityHelper.getContext(),
								maxReferenceDepth,
								0,
							);
							const referenceValue = referenceValues.find(v => String(v.value) === String(value));
							return referenceValue?.name || String(value);
						}

						return String(value);
					})
				);

				// Get bracket value if configured
				let bracketValue = '';
				if (mapping.bracketField && bracketFieldInfo) {
					const value = getFieldValue(entity, mapping.bracketField);
					if (value !== null && value !== undefined) {
						if (isAutotaskField(bracketFieldInfo) && bracketFieldInfo.isReference && bracketFieldInfo.referenceEntityType) {
							const referenceValues = await getReferenceValues(
								bracketFieldInfo.referenceEntityType,
								entityHelper.getContext(),
								maxReferenceDepth,
								0,
							);
							const referenceValue = referenceValues.find(v => String(v.value) === String(value));
							bracketValue = referenceValue?.name || String(value);
						} else {
							bracketValue = String(value);
						}
					}
				}

				// Get value
				const value = getFieldValue(entity, mapping.valueField);
				if (value === null || value === undefined) {
					return null;
				}

				// Handle reference value
				let finalValue: string | number = String(value);
				if (isAutotaskField(valueFieldInfo) && valueFieldInfo.isReference && valueFieldInfo.referenceEntityType) {
					const referenceValues = await getReferenceValues(
						valueFieldInfo.referenceEntityType,
						entityHelper.getContext(),
						maxReferenceDepth,
						0,
					);
					const referenceValue = referenceValues.find(v => String(v.value) === String(value));
					if (referenceValue) {
						finalValue = referenceValue.value;
					}
				}

				// Format name with bracket value
				const name = nameParts.filter(Boolean).join(mapping.separator);
				const displayName = bracketValue ? `${name} (${bracketValue})` : name;

				// Create entity value pair
				const pair: IEntityValuePair = {
					name: displayName,
					value: finalValue,
				};

				// Add optional properties if available
				if (entity.description) pair.description = entity.description as string;
				if (entity.isActive !== undefined) pair.isActive = entity.isActive as boolean;
				if (isAutotaskField(valueFieldInfo) && valueFieldInfo.referenceEntityType) {
					pair.referenceEntityType = valueFieldInfo.referenceEntityType;
				}

				return pair;
			} catch (error) {
				console.error('Failed to transform entity:', error);
				return null;
			}
		})
	);

	return transformResults.filter((pair): pair is IEntityValuePair => pair !== null);
}
