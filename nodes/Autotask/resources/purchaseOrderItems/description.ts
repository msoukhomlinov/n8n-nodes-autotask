import type { INodeProperties } from 'n8n-workflow';

export const purchaseOrderItemsFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'purchaseOrderItems',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a purchase order item',
				action: 'Create a purchase order item',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a purchase order item',
				action: 'Update a purchase order item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a purchase order item by ID',
				action: 'Get a purchase order item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple purchase order items',
				action: 'Get multiple purchase order items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of purchase order items',
				action: 'Count purchase order items',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Purchase Order Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['purchaseOrderItems'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the purchase order item to operate on',
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
				resource: ['purchaseOrderItems'],
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
