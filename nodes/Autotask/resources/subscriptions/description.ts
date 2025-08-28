import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a subscription',
		action: 'Create a subscription',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a subscription',
		action: 'Update a subscription',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a subscription by ID',
		action: 'Get a subscription',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple subscriptions using field filters',
		action: 'Get multiple subscriptions',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a subscription',
		action: 'Delete a subscription',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of subscriptions',
		action: 'Count subscriptions',
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
					'subscription',
				],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Subscription ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['subscription'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the subscription to operate on',
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
				resource: ['subscription'],
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

export const subscriptionFields = baseFields;
