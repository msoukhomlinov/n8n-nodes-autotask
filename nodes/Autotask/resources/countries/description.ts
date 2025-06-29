import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a country',
		action: 'Get a country',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many countries',
		action: 'Get many countries',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a country',
		action: 'Update a country',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count countries',
		action: 'Count countries',
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
				resource: ['country'],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Country ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['country'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the country to operate on',
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
				resource: ['country'],
				operation: ['update', 'getMany', 'count'],
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

export const countryFields = baseFields;
