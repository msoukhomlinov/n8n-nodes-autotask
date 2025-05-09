import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service call ticket resource',
		action: 'Create a service call ticket resource',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service call ticket resource by ID',
		action: 'Get a service call ticket resource',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple service call ticket resources using field filters',
		action: 'Get multiple service call ticket resources',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a service call ticket resource',
		action: 'Delete a service call ticket resource',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of service call ticket resources',
		action: 'Count service call ticket resources',
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
					'serviceCallTicketResource',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Service Call Ticket Resource ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['serviceCallTicketResource'],
				operation: ['get', 'delete'],
			},
		},
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
				resource: ['serviceCallTicketResource'],
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

export const serviceCallTicketResourceFields = baseFields;
