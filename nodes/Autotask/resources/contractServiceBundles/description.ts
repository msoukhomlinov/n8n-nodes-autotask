import type { INodeProperties } from 'n8n-workflow';

export const contractServiceBundleFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractServiceBundle',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract service bundle',
				action: 'Create a contract service bundle',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract service bundle',
				action: 'Update a contract service bundle',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract service bundle by ID',
				action: 'Get a contract service bundle',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract service bundles',
				action: 'Get multiple contract service bundles',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract service bundles',
				action: 'Count contract service bundles',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Service Bundle ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractServiceBundle'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract service bundle to operate on',
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
				resource: ['contractServiceBundle'],
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
