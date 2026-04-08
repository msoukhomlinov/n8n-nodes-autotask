import type { INodeProperties } from 'n8n-workflow';

export const resourceTimeOffBalanceFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['resourceTimeOffBalance'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get all year-by-year time-off balance records for a resource',
				action: 'Get resource time off balances',
			},
			{
				name: 'Get By Year',
				value: 'getByYear',
				description: 'Get the time-off balance for a specific calendar year for a resource',
				action: 'Get resource time off balance by year',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Resource ID',
		name: 'resourceID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resourceTimeOffBalance'],
				operation: ['get', 'getByYear'],
			},
		},
		description: 'The numeric ID of the resource',
	},
	{
		displayName: 'Year',
		name: 'year',
		type: 'number',
		required: true,
		default: new Date().getFullYear(),
		displayOptions: {
			show: {
				resource: ['resourceTimeOffBalance'],
				operation: ['getByYear'],
			},
		},
		description: 'The calendar year (e.g. 2024)',
	},
];
