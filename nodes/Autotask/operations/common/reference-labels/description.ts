import type { INodeProperties } from 'n8n-workflow';

/**
 * Common option for adding reference labels to get operations
 */
export const referenceLabelOption: INodeProperties = {
	displayName: 'Add Reference Labels',
	name: 'addReferenceLabels',
	type: 'boolean',
	default: true,
	description: 'Whether to automatically add "_label" fields for reference fields with human-readable values (no labels will be added for empty values)',
	displayOptions: {
		show: {
			operation: ['get', 'getMany', 'getManyAdvanced', 'whoAmI'],
		},
	},
};

/**
 * Helper function to add reference label option to a resource's properties
 */
export function addReferenceLabelOption(
	properties: INodeProperties[],
	resourceName: string,
): INodeProperties[] {
	// Create a copy of the option with resource-specific display options
	const resourceOption: INodeProperties = {
		...referenceLabelOption,
		displayOptions: {
			show: {
				...referenceLabelOption.displayOptions?.show,
				resource: [resourceName],
			},
		},
	};

	return [...properties, resourceOption];
}
