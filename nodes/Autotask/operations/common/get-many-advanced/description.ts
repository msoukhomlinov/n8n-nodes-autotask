import type { INodeProperties } from 'n8n-workflow';

/**
 * Common operation options for getManyAdvanced
 */
export const getManyAdvancedOptions: INodeProperties[] = [
	{
		displayName: 'Get All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				operation: ['getManyAdvanced'],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['resource', 'operation'],
		},
	},
	{
		displayName: 'Max Records',
		name: 'maxRecords',
		type: 'number',
		default: 10,
		description: 'Max number of records to return (1-500)',
		typeOptions: {
			minValue: 1,
			maxValue: 500,
			loadOptionsDependsOn: ['resource', 'operation'],
		},
		displayOptions: {
			show: {
				operation: ['getManyAdvanced'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Advanced Filter',
		name: 'advancedFilter',
		type: 'json',
		default: '',
		description: 'Must be a JSON string containing a "filter" array with Autotask API query criteria',
		hint: 'First use Get Field Info to confirm exact field names, then use Search Filter Build to construct the filter JSON. (Autotask API docs: https://ww4.autotask.net/help/DeveloperHelp/Content/APIs/REST/API_Calls/REST_Basic_Query_Calls.htm)',
		required: true,
		typeOptions: {
			alwaysOpenEditWindow: true,
			loadOptionsDependsOn: ['resource', 'operation'],
		},
		displayOptions: {
			show: {
				operation: ['getManyAdvanced'],
			},
		},
	},
];
