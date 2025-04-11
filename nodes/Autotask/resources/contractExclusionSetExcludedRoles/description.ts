import type { INodeProperties } from 'n8n-workflow';

export const contractExclusionSetExcludedRolesFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractExclusionSetExcludedRole',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract exclusion set excluded role',
				action: 'Create a contract exclusion set excluded role',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract exclusion set excluded role by ID',
				action: 'Get a contract exclusion set excluded role',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract exclusion set excluded roles',
				action: 'Get multiple contract exclusion set excluded roles',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract exclusion set excluded roles',
				action: 'Count contract exclusion set excluded roles',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract exclusion set excluded role',
				action: 'Delete a contract exclusion set excluded role',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Excluded Role ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractExclusionSetExcludedRole'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the contract exclusion set excluded role to operate on',
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
				resource: ['contractExclusionSetExcludedRole'],
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
