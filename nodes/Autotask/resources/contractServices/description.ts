import type { INodeProperties } from 'n8n-workflow';

export const contractServiceFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractService',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract service',
				action: 'Create a contract service',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract service',
				action: 'Update a contract service',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract service by ID',
				action: 'Get a contract service',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract services',
				action: 'Get multiple contract services',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract services',
				action: 'Count contract services',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Service ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractService'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the service to operate on',
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
				resource: ['contractService'],
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
