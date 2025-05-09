import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a quote location',
		action: 'Create a quote location',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a quote location',
		action: 'Update a quote location',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a quote location',
		action: 'Get a quote location',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many quote locations',
		action: 'Get many quote locations',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count quote locations',
		action: 'Count quote locations',
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
				resource: ['quoteLocation'],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Quote Location ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['quoteLocation'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the quote location to operate on',
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
				resource: ['quoteLocation'],
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

export const quoteLocationFields = baseFields;
