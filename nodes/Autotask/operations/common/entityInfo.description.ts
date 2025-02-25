import type { INodeProperties } from 'n8n-workflow';

/**
 * Entity info operation options for resource operations
 */
export const entityInfoOptions = [
	{
		name: 'Get Entity Info',
		value: 'getEntityInfo',
		description: 'Get metadata about this entity type',
		action: 'Get entity info',
	},
	{
		name: 'Get Field Info',
		value: 'getFieldInfo',
		description: 'Get field definitions for this entity type',
		action: 'Get field info',
	},
];

/**
 * Helper function to add entity info operations to a resource's operations
 */
export function addEntityInfoOperations(resourceName: string): INodeProperties[] {
	return [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: {
				show: {
					resource: [resourceName],
				},
			},
			options: [
				...entityInfoOptions,
				// Resource's existing operations will be spread after this
			],
			default: 'getEntityInfo',
		},
	];
}
