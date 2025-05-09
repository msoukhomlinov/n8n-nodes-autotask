import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service call task',
		action: 'Create a service call task',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service call task by ID',
		action: 'Get a service call task',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple service call tasks using field filters',
		action: 'Get multiple service call tasks',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a service call task',
		action: 'Delete a service call task',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of service call tasks',
		action: 'Count service call tasks',
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
					'serviceCallTask',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Service Call Task ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['serviceCallTask'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the service call task to operate on',
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
				resource: ['serviceCallTask'],
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

export const serviceCallTaskFields = baseFields;
