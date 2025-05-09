import type { INodeProperties } from 'n8n-workflow';

export const quoteItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'quoteItem',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a quote item',
				action: 'Create a quote item',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a quote item',
				action: 'Update a quote item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a quote item by ID',
				action: 'Get a quote item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple quote items',
				action: 'Get multiple quote items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of quote items',
				action: 'Count quote items',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a quote item',
				action: 'Delete a quote item',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Quote Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['quoteItem'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the quote item to operate on',
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
				resource: ['quoteItem'],
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
