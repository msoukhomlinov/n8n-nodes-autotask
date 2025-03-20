import type { INodeProperties } from 'n8n-workflow';

export const contractBlockHourFactorFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractBlockHourFactor',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract block hour factor',
				action: 'Create a contract block hour factor',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract block hour factor',
				action: 'Update a contract block hour factor',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract block hour factor by ID',
				action: 'Get a contract block hour factor',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract block hour factors',
				action: 'Get multiple contract block hour factors',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract block hour factors',
				action: 'Count contract block hour factors',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Block Hour Factor ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractBlockHourFactor'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract block hour factor to operate on',
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
				resource: ['contractBlockHourFactor'],
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
