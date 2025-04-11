import type { INodeProperties } from 'n8n-workflow';

export const contractExclusionSetExcludedWorkTypesFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractExclusionSetExcludedWorkType',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract exclusion set excluded work type',
				action: 'Create a contract exclusion set excluded work type',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract exclusion set excluded work type by ID',
				action: 'Get a contract exclusion set excluded work type',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract exclusion set excluded work types',
				action: 'Get multiple contract exclusion set excluded work types',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract exclusion set excluded work types',
				action: 'Count contract exclusion set excluded work types',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contract exclusion set excluded work type',
				action: 'Delete a contract exclusion set excluded work type',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Excluded Work Type ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractExclusionSetExcludedWorkType'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the contract exclusion set excluded work type to operate on',
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
				resource: ['contractExclusionSetExcludedWorkType'],
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
