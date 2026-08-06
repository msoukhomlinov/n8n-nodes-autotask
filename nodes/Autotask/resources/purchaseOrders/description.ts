import type { INodeProperties } from 'n8n-workflow';

export const purchaseOrdersFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'purchaseOrders',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a purchase order',
				action: 'Create a purchase order',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a purchase order',
				action: 'Update a purchase order',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a purchase order by ID',
				action: 'Get a purchase order',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple purchase orders',
				action: 'Get multiple purchase orders',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of purchase orders',
				action: 'Count purchase orders',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Purchase Order ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['purchaseOrders'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the purchase order to operate on',
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
				resource: ['purchaseOrders'],
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
