import type { INodeProperties } from 'n8n-workflow';

export const contractRoleCostsFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractRoleCosts',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract role cost',
				action: 'Create a contract role cost',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract role cost',
				action: 'Update a contract role cost',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract role cost by ID',
				action: 'Get a contract role cost',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract role costs',
				action: 'Get multiple contract role costs',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract role costs',
				action: 'Count contract role costs',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Contract Role Cost ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractRoleCosts'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract role cost to update',
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
				resource: ['contractRoleCosts'],
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
