import type { INodeProperties } from 'n8n-workflow';

/**
 * Common option for adding picklist labels to get operations
 */
export const picklistLabelOption: INodeProperties = {
	displayName: 'Add Picklist Labels',
	name: 'addPicklistLabels',
	type: 'boolean',
	default: true,
	description: 'Whether to automatically add "_label" fields for picklist fields with human-readable values (no labels will be added for empty values)',
	displayOptions: {
		show: {
			operation: ['get', 'getMany', 'getManyAdvanced'],
		},
	},
};

/**
 * Helper function to add picklist label option to a resource's properties
 */
export function addPicklistLabelOption(
	properties: INodeProperties[],
	resourceName: string,
): INodeProperties[] {
	// Create a copy of the option with resource-specific display options
	const resourceOption: INodeProperties = {
		...picklistLabelOption,
		displayOptions: {
			show: {
				...picklistLabelOption.displayOptions?.show,
				resource: [resourceName],
			},
		},
	};

	// Log that we're adding the option to help with debugging
	console.debug(`[addPicklistLabelOption] Adding picklist label option to resource: ${resourceName}`);

	return [...properties, resourceOption];
}
