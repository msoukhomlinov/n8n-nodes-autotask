import type { IDataObject } from 'n8n-workflow';

/**
 * Interface for UDF field in API response
 */
interface IUdfField {
	name: string;
	value: unknown;
}

/**
 * Flattens UDFs in a single API response object
 * When enabled, moves UDF name/value pairs to the parent object
 * while preserving the original userDefinedFields array
 */
export function flattenUdfs<T extends IDataObject>(entity: T): T {
	if (!entity || typeof entity !== 'object') {
		return entity;
	}

	// Check if entity has userDefinedFields
	const userDefinedFields = entity.userDefinedFields as IUdfField[] | undefined;
	if (!userDefinedFields || !Array.isArray(userDefinedFields)) {
		return entity;
	}

	// Create a shallow copy of the entity as Record to avoid index signature error
	const result = { ...entity } as Record<string, unknown>;

	// Flatten UDFs to top level
	for (const udf of userDefinedFields) {
		if (udf && typeof udf === 'object' && 'name' in udf && 'value' in udf) {
			// Add UDF to top level with its name as the key
			result[udf.name as string] = udf.value;
		}
	}

	return result as T;
}

/**
 * Flattens UDFs in an array of API response objects
 */
export function flattenUdfsArray<T extends IDataObject>(entities: T[]): T[] {
	if (!entities || !Array.isArray(entities)) {
		return entities;
	}

	return entities.map(entity => flattenUdfs(entity));
}
