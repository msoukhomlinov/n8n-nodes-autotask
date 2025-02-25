import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { entityInfoOptions } from '../operations/common/entityInfo.description';
import { getManyAdvancedOptions } from '../operations/common/get-many-advanced';

/**
 * Operation group types
 */
export enum OperationGroup {
	ENTITY_INFO = 'entityInfo',
	ADVANCED_QUERY = 'advancedQuery',
}

/**
 * Operation dependency configuration
 */
export interface IOperationDependency {
	group: OperationGroup;
	requires?: OperationGroup[];
}

/**
 * Operation addition configuration
 */
export interface IOperationAdditionConfig {
	resourceName: string;
	excludeOperations?: string[];
	dependencies?: IOperationDependency[];
}

/**
 * Add operations to a resource's operation options
 */
export function addOperationsToResource(
	baseFields: INodeProperties[],
	config: IOperationAdditionConfig,
): INodeProperties[] {
	const properties = [...baseFields];
	const operationProperty = properties.find(p => p.name === 'operation' && p.type === 'options') as INodeProperties & { options: INodePropertyOptions[] };

	if (operationProperty) {
		// Add entity info operations if not excluded
		if (!config.excludeOperations?.includes('entityInfo')) {
			operationProperty.options = [...entityInfoOptions, ...operationProperty.options];
		}

		// Add getManyAdvanced operation if not excluded
		if (!config.excludeOperations?.includes('getManyAdvanced')) {
			operationProperty.options = [...operationProperty.options, {
				name: 'Get Many (Advanced)',
				value: 'getManyAdvanced',
				description: 'Get multiple entities using JSON filters',
				action: 'Get multiple entities using advanced filters',
			}];

			// Add getManyAdvanced parameters
			const advancedOptions = getManyAdvancedOptions.map(option => ({
				...option,
				displayOptions: {
					...option.displayOptions,
					show: {
						...option.displayOptions?.show,
						resource: [config.resourceName],
					},
				},
			}));
			properties.push(...advancedOptions);
		}
	}

	return properties;
}

/**
 * Validate operation dependencies
 */
export function validateOperationDependencies(dependencies: IOperationDependency[]): boolean {
	const groups = new Set(dependencies.map(d => d.group));

	for (const dependency of dependencies) {
		if (dependency.requires) {
			for (const required of dependency.requires) {
				if (!groups.has(required)) {
					return false;
				}
			}
		}
	}

	return true;
}
