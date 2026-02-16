import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { entityInfoOptions } from '../operations/common/entityInfo.description';
import { getManyAdvancedOptions } from '../operations/common/get-many-advanced';
import { getManyOptions } from '../operations/common/get-many';
import { addPicklistLabelOption } from '../operations/common/picklist-labels';
import { addReferenceLabelOption } from '../operations/common/reference-labels';
import { addSelectColumnsOption } from '../operations/common/select-columns';
import { flattenUdfsOption } from '../operations/common/udf-flattening';
import { addAgentFriendlyOptions, addDryRunOption } from '../operations/common/json-parameters';
import { CACHEABLE_API_RESPONSE_OPERATIONS } from './cache/response-cache';
import { isNodeResourceImpersonationSupported } from './impersonation';

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

function ensureOperationVisibility(
	property: INodeProperties,
	resourceName: string,
	operations: string[],
): INodeProperties {
	const existingShow = property.displayOptions?.show ?? {};
	const existingResources = Array.isArray(existingShow.resource) ? existingShow.resource : [];
	const existingOperations = Array.isArray(existingShow.operation) ? existingShow.operation : [];
	const mergedResources = Array.from(new Set([...existingResources, resourceName]));
	const mergedOperations = Array.from(new Set([...existingOperations, ...operations]));

	return {
		...property,
		displayOptions: {
			...property.displayOptions,
			show: {
				...existingShow,
				resource: mergedResources,
				operation: mergedOperations,
			},
		},
	};
}

function upsertImpersonationProperty(
	properties: INodeProperties[],
	resourceName: string,
	property: INodeProperties,
): INodeProperties[] {
	const existingIndex = properties.findIndex((prop) => prop.name === property.name);
	if (existingIndex === -1) {
		return [...properties, property];
	}

	const updated = [...properties];
	updated[existingIndex] = ensureOperationVisibility(
		updated[existingIndex],
		resourceName,
		['create', 'update'],
	);
	return updated;
}

/**
 * Add operations to a resource's operation options
 */
export function addOperationsToResource(
	baseFields: INodeProperties[],
	config: IOperationAdditionConfig,
): INodeProperties[] {
	let properties = [...baseFields];
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

		// Check for write operations (create, update, delete)
		const hasWriteOperations = operationProperty.options.some((op: INodePropertyOptions) =>
			['create', 'update', 'delete'].includes(op.value as string)
		);
		const hasCreateOrUpdateOperations = operationProperty.options.some((op: INodePropertyOptions) =>
			['create', 'update'].includes(op.value as string)
		);

		// Add dry run option for write operations if not already present
		if (hasWriteOperations) {
			const hasDryRunOption = properties.some(prop => prop.name === 'dryRun');
			if (!hasDryRunOption && !config.excludeOperations?.includes('dryRun')) {
				properties = addDryRunOption(properties, config.resourceName);
			}
		}

		if (
			hasCreateOrUpdateOperations &&
			isNodeResourceImpersonationSupported(config.resourceName)
		) {
			properties = upsertImpersonationProperty(properties, config.resourceName, {
				displayName: 'Impersonation Resource ID',
				name: 'impersonationResourceId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: [config.resourceName],
						operation: ['create', 'update'],
					},
				},
				description:
					'Optional resource ID to impersonate for write requests. Leave blank to write as the credential user.',
			});

			properties = upsertImpersonationProperty(properties, config.resourceName, {
				displayName: 'Proceed Without Impersonation If Denied',
				name: 'proceedWithoutImpersonationIfDenied',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: [config.resourceName],
						operation: ['create', 'update'],
					},
				},
				description:
					'Whether to retry denied impersonated writes once without impersonation and proceed as the API user. Only applies when Impersonation Resource ID is set.',
			});
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

			// Add response cache configuration fields for cacheable operations (per-node)
			const cacheableOperationsForResource = CACHEABLE_API_RESPONSE_OPERATIONS
				.filter(entry => entry.resource.toLowerCase() === config.resourceName.toLowerCase())
				.map(entry => entry.operation);

			if (cacheableOperationsForResource.length > 0) {
				const hasCacheResponseOption = updatedProperties.some(prop => prop.name === 'cacheResponse');
				const hasCacheTtlOption = updatedProperties.some(prop => prop.name === 'cacheTtl');

				if (!hasCacheResponseOption) {
					updatedProperties.push({
						displayName: 'Cache Response',
						name: 'cacheResponse',
						type: 'boolean',
						default: false,
						description: 'Whether to cache the API response for this operation to reduce repeated Autotask calls',
						displayOptions: {
							show: {
								resource: [config.resourceName],
								operation: cacheableOperationsForResource,
							},
						},
					});
				}

				if (!hasCacheTtlOption) {
					updatedProperties.push({
						displayName: 'Cache TTL (seconds)',
						name: 'cacheTtl',
						type: 'number',
						default: 30,
						typeOptions: {
							maxValue: 14_400, // 4 hours
							minValue: 1,
						},
						description:
							'Maximum time to keep a cached API response for this operation (in seconds). ' +
							'If a valid cached response exists for the same parameters, it will be returned immediately and no new API request will be sent until the TTL expires.',
						displayOptions: {
							show: {
								resource: [config.resourceName],
								operation: cacheableOperationsForResource,
								cacheResponse: [true],
							},
						},
					});
				}
			}

			return updatedProperties;
		}
	}

	// Check for write operations in resources without get operations (write-only resources)
	if (!operationProperty) {
		const writeOnlyOperationProperty = properties.find(p => p.name === 'operation' && p.type === 'options') as INodeProperties & { options: INodePropertyOptions[] };
		if (writeOnlyOperationProperty) {
			const hasWriteOperations = writeOnlyOperationProperty.options.some((op: INodePropertyOptions) =>
				['create', 'update', 'delete'].includes(op.value as string)
			);

		// Add dry run option for write operations if not already present
		if (hasWriteOperations) {
			const hasDryRunOption = properties.some(prop => prop.name === 'dryRun');
			if (!hasDryRunOption && !config.excludeOperations?.includes('dryRun')) {
				properties = addDryRunOption(properties, config.resourceName);
			}
		}
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
