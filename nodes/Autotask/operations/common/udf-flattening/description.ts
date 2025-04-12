import type { INodeProperties } from 'n8n-workflow';

/**
 * Common option for flattening UDFs in API responses
 */
export const flattenUdfsOption: INodeProperties = {
	displayName: 'Flatten User-Defined Fields',
	name: 'flattenUdfs',
	type: 'boolean',
	default: false,
	description: 'Whether to bring user-defined fields up to the top level of each object',
	hint: 'When enabled, UDFs will be accessible as top-level properties instead of being nested in the userDefinedFields array',
	displayOptions: {
		show: {
			operation: ['get', 'getMany', 'getManyAdvanced'],
		},
	},
	typeOptions: {
		loadOptionsDependsOn: ['resource', 'operation'],
	},
};

/**
 * Helper function to add the flattenUdfs option to a resource's properties
 */
export function addFlattenUdfsOption(properties: INodeProperties[], resourceName: string): INodeProperties[] {
	const updatedProperties = [...properties];

	// Only add if not already present
	if (!updatedProperties.some(prop => prop.name === 'flattenUdfs')) {
		updatedProperties.push({
			...flattenUdfsOption,
			displayOptions: {
				...flattenUdfsOption.displayOptions,
				show: {
					...flattenUdfsOption.displayOptions?.show,
					resource: [resourceName],
				},
			},
		});
	}

	return updatedProperties;
}
