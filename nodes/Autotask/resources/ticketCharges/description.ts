import type { INodeProperties } from 'n8n-workflow';

export const ticketChargeFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketCharge',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a ticket charge',
				action: 'Create a ticket charge',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a ticket charge (only when isBilled = false)',
				action: 'Update a ticket charge',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a ticket charge (only when isBilled = false)',
				action: 'Delete a ticket charge',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket charge by ID',
				action: 'Get a ticket charge',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket charges',
				action: 'Get multiple ticket charges',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of ticket charges',
				action: 'Count ticket charges',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Charge ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketCharge'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the charge to operate on',
	},
	{
		displayName: 'Ticket ID',
		name: 'ticketID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketCharge'],
				operation: ['delete'],
			},
		},
		description: 'ID of the ticket that the charge belongs to',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {},
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['resource', 'operation'],
			resourceMapper: {
				resourceMapperMethod: 'getFields',
				mode: 'add',
				fieldWords: {
					singular: 'field',
					plural: 'fields',
				},
				addAllFields: false,
				multiKeyMatch: true,
				supportAutoMap: true,
			},
		},
		displayOptions: {
			show: {
				resource: ['ticketCharge'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
