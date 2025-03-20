import type { INodeProperties } from 'n8n-workflow';

export const contractRateFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractRate',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract rate',
				action: 'Create a contract rate',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract rate',
				action: 'Update a contract rate',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract rate by ID',
				action: 'Get a contract rate',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract rates',
				action: 'Get multiple contract rates',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract rates',
				action: 'Count contract rates',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Rate ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractRate'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract rate to operate on',
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
				resource: ['contractRate'],
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
