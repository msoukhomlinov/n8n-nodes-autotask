import type { INodeProperties } from 'n8n-workflow';

export const contractExclusionRoleFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractExclusionRoles',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract exclusion role',
				action: 'Create a contract exclusion role',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract exclusion role by ID',
				action: 'Get a contract exclusion role',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract exclusion roles',
				action: 'Get multiple contract exclusion roles',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract exclusion roles',
				action: 'Count contract exclusion roles',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract exclusion role',
				action: 'Delete a contract exclusion role',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Exclusion Role ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractExclusionRoles'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the contract exclusion role to operate on',
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
				resource: ['contractExclusionRoles'],
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

