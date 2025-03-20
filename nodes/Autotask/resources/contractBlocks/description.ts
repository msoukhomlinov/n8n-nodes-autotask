import type { INodeProperties } from 'n8n-workflow';

export const contractBlockFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractBlock',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract block',
				action: 'Create a contract block',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract block',
				action: 'Update a contract block',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract block by ID',
				action: 'Get a contract block',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract blocks',
				action: 'Get multiple contract blocks',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract blocks',
				action: 'Count contract blocks',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Block ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractBlock'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract block to operate on',
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
				resource: ['contractBlock'],
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
