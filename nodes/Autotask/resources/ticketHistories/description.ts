import type { INodeProperties } from 'n8n-workflow';

export const ticketHistoryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['TicketHistory'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket history by ID',
				action: 'Get a ticket history',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many ticket histories',
				action: 'Get many ticket histories',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count ticket histories',
				action: 'Count ticket histories',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Ticket History ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['TicketHistory'],
				operation: ['get'],
			},
		},
		description: 'The ID of the ticket history to retrieve',
	},
	{
		displayName: 'Ticket ID',
		name: 'ticketID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['TicketHistory'],
				operation: ['get', 'getMany', 'count'],
			},
		},
		description: 'The ID of the ticket to get history for. This is the only allowed filter.',
	},
];
