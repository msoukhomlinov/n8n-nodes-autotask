import type { INodeProperties } from 'n8n-workflow';

// Define the operation options
export const apiThresholdOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['apiThreshold'],
			},
		},
		options: [
			{
				name: 'Get API Usage',
				value: 'get',
				description: 'Retrieve current API usage and threshold information',
				action: 'Get API usage threshold information',
			},
		],
		default: 'get',
	},
];

// No additional fields needed for the get operation
export const apiThresholdFields: INodeProperties[] = [];

// Export everything
export const apiThresholdDescription = [...apiThresholdOperations, ...apiThresholdFields];
