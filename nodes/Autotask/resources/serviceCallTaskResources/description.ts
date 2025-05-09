import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service call task resource',
		action: 'Create a service call task resource',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service call task resource by ID',
		action: 'Get a service call task resource',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple service call task resources using field filters',
		action: 'Get multiple service call task resources',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a service call task resource',
		action: 'Delete a service call task resource',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of service call task resources',
		action: 'Count service call task resources',
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
					'serviceCallTaskResource',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Service Call Task Resource ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['serviceCallTaskResource'],
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
				resource: ['serviceCallTaskResource'],
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

export const serviceCallTaskResourceFields = baseFields;
