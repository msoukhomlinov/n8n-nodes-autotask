import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Update',
		value: 'update',
		description: 'Update a billing item',
		action: 'Update a billing item',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a billing item by ID',
		action: 'Get a billing item',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple billing items using field filters',
		action: 'Get multiple billing items',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of billing items',
		action: 'Count billing items',
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
					'billingItems',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Billing Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['billingItems'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the billing item to operate on',
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
				resource: ['billingItems'],
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

export const billingItemsFields = baseFields;
