import type { INodeProperties } from 'n8n-workflow';

export const contractBillingRuleFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractBillingRule',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract billing rule',
				action: 'Create a contract billing rule',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract billing rule',
				action: 'Update a contract billing rule',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract billing rule by ID',
				action: 'Get a contract billing rule',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract billing rules',
				action: 'Get multiple contract billing rules',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract billing rules',
				action: 'Count contract billing rules',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract billing rule',
				action: 'Delete a contract billing rule',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Billing Rule ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractBillingRule'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the contract billing rule to operate on',
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
				resource: ['contractBillingRule'],
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
