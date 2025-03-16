import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service call',
		action: 'Create a service call',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a service call',
		action: 'Update a service call',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service call by ID',
		action: 'Get a service call',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple service calls using field filters',
		action: 'Get multiple service calls',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a service call',
		action: 'Delete a service call',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of service calls',
		action: 'Count service calls',
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
					'serviceCall',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Service Call ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['serviceCall'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the service call to operate on',
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
				resource: ['serviceCall'],
				operation: ['create', 'update', 'getMany', 'count'],
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

export const serviceCallFields = baseFields;
