import type { INodeProperties } from 'n8n-workflow';

export const contractTicketPurchasesFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractTicketPurchase',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract ticket purchase',
				action: 'Create a contract ticket purchase',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract ticket purchase',
				action: 'Update a contract ticket purchase',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract ticket purchase by ID',
				action: 'Get a contract ticket purchase',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract ticket purchases',
				action: 'Get multiple contract ticket purchases',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract ticket purchases',
				action: 'Count contract ticket purchases',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Contract Ticket Purchase ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractTicketPurchase'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract ticket purchase to operate on',
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
				resource: ['contractTicketPurchase'],
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
