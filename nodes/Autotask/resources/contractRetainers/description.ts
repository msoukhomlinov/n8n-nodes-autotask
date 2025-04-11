import type { INodeProperties } from 'n8n-workflow';

export const contractRetainersFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractRetainer',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract retainer',
				action: 'Create a contract retainer',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract retainer',
				action: 'Update a contract retainer',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract retainer by ID',
				action: 'Get a contract retainer',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract retainers',
				action: 'Get multiple contract retainers',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract retainers',
				action: 'Count contract retainers',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Retainer ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractRetainer'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the retainer to operate on',
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
				resource: ['contractRetainer'],
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
