import type { INodeProperties } from 'n8n-workflow';

export const ticketChecklistItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketChecklistItem',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a ticket checklist item',
				action: 'Create a ticket checklist item',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a ticket checklist item',
				action: 'Update a ticket checklist item',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a ticket checklist item',
				action: 'Delete a ticket checklist item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket checklist item by ID',
				action: 'Get a ticket checklist item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket checklist items',
				action: 'Get multiple ticket checklist items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of ticket checklist items',
				action: 'Count ticket checklist items',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketChecklistItem'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the checklist item to operate on',
	},
	{
		displayName: 'Ticket ID',
		name: 'ticketID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketChecklistItem'],
				operation: ['delete'],
			},
		},
		description: 'ID of the ticket that the checklist item belongs to',
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
				resource: ['ticketChecklistItem'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
