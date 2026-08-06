import type { INodeProperties } from 'n8n-workflow';

export const purchaseOrderItemReceivingFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'purchaseOrderItemReceiving',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create purchase order item receiving records',
				action: 'Create purchase order item receiving records',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a purchase order item receiving record by ID',
				action: 'Get a purchase order item receiving record',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple purchase order item receiving records',
				action: 'Get multiple purchase order item receiving records',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of purchase order item receiving records',
				action: 'Count purchase order item receiving records',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Purchase Order Item Receiving ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['purchaseOrderItemReceiving'],
				operation: ['get'],
			},
		},
		description: 'The ID of the purchase order item receiving record to operate on',
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
				resource: ['purchaseOrderItemReceiving'],
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
