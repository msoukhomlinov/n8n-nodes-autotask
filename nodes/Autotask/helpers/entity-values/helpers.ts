import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions } from 'n8n-workflow';
import type { IEntityValuePair } from './index';
import type { IAutotaskEntity } from '../../types';
import { EntityValueHelper } from './value-helper';
import { initializeCache } from '../cache/init';

/**
 * Create a new EntityValueHelper instance for reference field handling
 */
export async function createReferenceHelper(
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
): Promise<EntityValueHelper<IAutotaskEntity>> {
	// Initialize cache service
	const cacheService = await initializeCache(context);

	// Create helper with cache service
	return new EntityValueHelper<IAutotaskEntity>(context as ILoadOptionsFunctions, entityType, {
		cacheService,
	});
}

/**
 * Get reference values for a field
 */
export async function getReferenceValues(
	entityType: string,
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	maxReferenceDepth: number,
	referenceDepth: number,
): Promise<IEntityValuePair[]> {
	// Check reference depth limit
	if (referenceDepth >= maxReferenceDepth) {
		return [];
	}

	// Create helper and get values
	const helper = await createReferenceHelper(entityType, context);
	const entities = await helper.getValues();

	// Map to name/value pairs
	return entities.map((entity: IAutotaskEntity) => ({
		name: helper.getEntityDisplayName(entity, { useMapping: true }),
		value: entity.id || 0,
	}));
}
