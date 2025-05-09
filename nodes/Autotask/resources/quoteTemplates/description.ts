import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a quote template',
		action: 'Get a quote template',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many quote templates',
		action: 'Get many quote templates',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count quote templates',
		action: 'Count quote templates',
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
				resource: ['quoteTemplate'],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Quote Template ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['quoteTemplate'],
				operation: ['get'],
			},
		},
		description: 'The ID of the quote template to retrieve',
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
				resource: ['quoteTemplate'],
				operation: ['getMany', 'count'],
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

export const quoteTemplateFields = baseFields;
