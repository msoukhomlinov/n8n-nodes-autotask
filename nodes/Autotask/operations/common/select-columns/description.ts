import type { INodeProperties } from 'n8n-workflow';

/**
 * Common option for selecting which columns to return in get operations
 */
export const selectColumnsOption: INodeProperties = {
	displayName: 'Select Columns Names or IDs.',
	name: 'selectColumns',
	type: 'multiOptions',
	default: [],
	description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'Choose which fields to include in the response. If no fields are selected, all fields will be returned. The ID field is always included regardless of selection.',
	displayOptions: {
		show: {
			operation: ['get', 'getMany', 'getManyAdvanced', 'whoAmI'],
		},
	},
	typeOptions: {
		loadOptionsMethod: 'getSelectColumns',
	},
};

/**
 * Helper function to add select columns option to a resource's properties
 */
export function addSelectColumnsOption(
	properties: INodeProperties[],
	resourceName: string,
): INodeProperties[] {
	// Create a copy of the option with resource-specific display options
	const resourceOption: INodeProperties = {
		...selectColumnsOption,
		displayOptions: {
			show: {
				...selectColumnsOption.displayOptions?.show,
				resource: [resourceName],
			},
		},
	};

	return [...properties, resourceOption];
}
