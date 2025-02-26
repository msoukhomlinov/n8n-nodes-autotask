import type { INodeProperties } from 'n8n-workflow';

/**
 * Common operation options for getMany
 */
export const getManyOptions: INodeProperties[] = [
	{
		displayName: 'Get All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				operation: ['getMany'],
			},
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
		},
		displayOptions: {
			show: {
				operation: ['getMany'],
				returnAll: [false],
			},
		},
	},
];
