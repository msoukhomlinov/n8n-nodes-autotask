import type { INodeProperties } from 'n8n-workflow';

/**
 * Common operation options for getManyAdvanced
 */
export const getManyAdvancedOptions: INodeProperties[] = [
	{
		displayName: 'Advanced Filter',
		name: 'advancedFilter',
		type: 'json',
		default: '',
		description: 'Must be a JSON string containing a "filter" array with Autotask API query criteria',
		hint: 'First use Get Field Info to confirm exact field names, then use Search Filter Build to construct the filter JSON. (Autotask API docs: https://ww4.autotask.net/help/DeveloperHelp/Content/APIs/REST/API_Basic_Query_Calls.htm.)',
		required: true,
		typeOptions: {
			alwaysOpenEditWindow: true,
		},
		displayOptions: {
			show: {
				operation: ['getManyAdvanced'],
			},
		},
	},
];
