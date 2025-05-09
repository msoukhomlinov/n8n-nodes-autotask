import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service call ticket',
		action: 'Create a service call ticket',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service call ticket by ID',
		action: 'Get a service call ticket',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple service call tickets using field filters',
		action: 'Get multiple service call tickets',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a service call ticket',
		action: 'Delete a service call ticket',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of service call tickets',
		action: 'Count service call tickets',
	},
];

const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'serviceCallTicket',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Service Call Ticket ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['serviceCallTicket'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the service call ticket to operate on',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		required: true,
		displayOptions: {
			show: {
				resource: ['serviceCallTicket'],
				operation: ['create', 'getMany', 'count'],
			},
		},
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
	},
];

export const serviceCallTicketFields = baseFields;
