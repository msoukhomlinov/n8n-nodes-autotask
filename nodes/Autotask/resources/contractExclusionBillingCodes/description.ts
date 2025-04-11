import type { INodeProperties } from 'n8n-workflow';

export const contractExclusionBillingCodeFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractExclusionBillingCode',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract exclusion billing code',
				action: 'Create a contract exclusion billing code',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract exclusion billing code by ID',
				action: 'Get a contract exclusion billing code',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract exclusion billing codes',
				action: 'Get multiple contract exclusion billing codes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract exclusion billing codes',
				action: 'Count contract exclusion billing codes',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract exclusion billing code',
				action: 'Delete a contract exclusion billing code',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Exclusion Billing Code ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractExclusionBillingCode'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the contract exclusion billing code to operate on',
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
				resource: ['contractExclusionBillingCode'],
				operation: ['create', 'getMany', 'count'],
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
