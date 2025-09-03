import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { entityInfoOptions } from '../operations/common/entityInfo.description';
import { getManyAdvancedOptions } from '../operations/common/get-many-advanced';
import { getManyOptions } from '../operations/common/get-many';
import { addPicklistLabelOption } from '../operations/common/picklist-labels';
import { addReferenceLabelOption } from '../operations/common/reference-labels';
import { addSelectColumnsOption } from '../operations/common/select-columns';
import { flattenUdfsOption } from '../operations/common/udf-flattening';
import { addAgentFriendlyOptions } from '../operations/common/json-parameters';

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
	agentFriendly?: {
		includeBodyJson?: boolean;
		includeSelectColumnsJson?: boolean;
		includeDryRun?: boolean;
	};
}

/**
 * Sort operations alphabetically by name
 */
function sortOperations(operations: INodePropertyOptions[]): INodePropertyOptions[] {
	return [...operations].sort((a, b) => a.name.localeCompare(b.name));
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
		// Sort the initial operations alphabetically
		operationProperty.options = sortOperations(operationProperty.options);

		// Add entity info operations if not excluded
		if (!config.excludeOperations?.includes('entityInfo')) {
			operationProperty.options = [...entityInfoOptions, ...operationProperty.options];
			// Re-sort after adding entity info operations
			operationProperty.options = sortOperations(operationProperty.options);
		}

		// Add getMany options if the operation exists and isn't excluded
		if (operationProperty.options.some((op: INodePropertyOptions) => op.value === 'getMany') && !config.excludeOperations?.includes('getMany')) {
			const getManyPropertyOptions = getManyOptions.map(option => ({
				...option,
				displayOptions: {
					...option.displayOptions,
					show: {
						...option.displayOptions?.show,
						resource: [config.resourceName],
					},
				},
			}));
			properties.push(...getManyPropertyOptions);
		}

		// Add getManyAdvanced operation if not excluded
		if (!config.excludeOperations?.includes('getManyAdvanced')) {
			operationProperty.options = [...operationProperty.options, {
				name: 'Get Many (Advanced)',
				value: 'getManyAdvanced',
				description: 'Get multiple entities using JSON filters',
				action: 'Get multiple entities using advanced filters',
			}];
			// Re-sort after adding getManyAdvanced operation
			operationProperty.options = sortOperations(operationProperty.options);

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

		// Add picklist label option if get operations exist, not excluded, and not already present
		const hasGetOperations = operationProperty.options.some((op: INodePropertyOptions) =>
			['get', 'getMany', 'getManyAdvanced'].includes(op.value as string)
		);

		const hasPicklistLabelOption = properties.some(prop => prop.name === 'addPicklistLabels');
		const hasReferenceLabelOption = properties.some(prop => prop.name === 'addReferenceLabels');

		if (hasGetOperations) {
			let updatedProperties = [...properties];

			// Add picklist label option if not excluded and not already present
			if (!config.excludeOperations?.includes('picklistLabels') && !hasPicklistLabelOption) {
				updatedProperties = addPicklistLabelOption(updatedProperties, config.resourceName);
			}

			// Add reference label option if not excluded and not already present
			if (!config.excludeOperations?.includes('referenceLabels') && !hasReferenceLabelOption) {
				updatedProperties = addReferenceLabelOption(updatedProperties, config.resourceName);
			}

			// Add select columns option if not excluded and not already present
			const hasSelectColumnsOption = updatedProperties.some(prop => prop.name === 'selectColumns');
			if (!config.excludeOperations?.includes('selectColumns') && !hasSelectColumnsOption) {
				updatedProperties = addSelectColumnsOption(updatedProperties, config.resourceName);
			}

			// Add UDF flattening option if not excluded and not already present
			const hasFlattenUdfsOption = updatedProperties.some(prop => prop.name === 'flattenUdfs');
			if (!config.excludeOperations?.includes('flattenUdfs') && !hasFlattenUdfsOption) {
				// Add UDF flattening option with resource-specific display options
				updatedProperties.push({
					...flattenUdfsOption,
					displayOptions: {
						...flattenUdfsOption.displayOptions,
						show: {
							...flattenUdfsOption.displayOptions?.show,
							resource: [config.resourceName],
						},
					},
				});
			}

			// Add agent-friendly options (JSON parameters, dry run)
			const agentFriendlyConfig = {
				includeBodyJson: config.agentFriendly?.includeBodyJson ?? false,
				includeSelectColumnsJson: config.agentFriendly?.includeSelectColumnsJson ?? false,
				includeDryRun: config.agentFriendly?.includeDryRun ?? false,
			};
			updatedProperties = addAgentFriendlyOptions(updatedProperties, config.resourceName, agentFriendlyConfig);

			return updatedProperties;
		}
	}

	// Add agent-friendly options for resources without get operations (write-only resources)
	const agentFriendlyConfig = {
		includeBodyJson: config.agentFriendly?.includeBodyJson ?? false,
		includeSelectColumnsJson: config.agentFriendly?.includeSelectColumnsJson ?? false,
		includeDryRun: config.agentFriendly?.includeDryRun ?? false,
	};
	return addAgentFriendlyOptions(properties, config.resourceName, agentFriendlyConfig);
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
