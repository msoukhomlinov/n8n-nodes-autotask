import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a quote',
		action: 'Create a quote',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a quote',
		action: 'Update a quote',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a quote',
		action: 'Get a quote',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many quotes',
		action: 'Get many quotes',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count quotes',
		action: 'Count quotes',
	},
];

export const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['quote'],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Quote ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['quote'],
				operation: ['update', 'get'], // No 'delete' operation
			},
		},
		description: 'The ID of the quote to operate on',
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
				resource: ['quote'],
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

export const quoteFields = baseFields;
