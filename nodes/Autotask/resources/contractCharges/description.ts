import type { INodeProperties } from 'n8n-workflow';

export const contractChargeFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractCharge',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract charge',
				action: 'Create a contract charge',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract charge',
				action: 'Update a contract charge',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract charge',
				action: 'Delete a contract charge',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract charge by ID',
				action: 'Get a contract charge',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract charges',
				action: 'Get multiple contract charges',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract charges',
				action: 'Count contract charges',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Charge ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractCharge'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the charge to operate on',
	},
	{
		displayName: 'Contract ID',
		name: 'contractID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractCharge'],
				operation: ['delete'],
			},
		},
		description: 'The ID of the contract that the charge belongs to',
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
				resource: ['contractCharge'],
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
