import type { INodeProperties } from 'n8n-workflow';

export const tagAliasFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'tagAlias',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a tag alias',
				action: 'Create a tag alias',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a tag alias',
				action: 'Delete a tag alias',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a tag alias by ID',
				action: 'Get a tag alias',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple tag aliases',
				action: 'Get multiple tag aliases',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of tag aliases',
				action: 'Count tag aliases',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Alias ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['tagAlias'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the tag alias to operate on',
	},
	{
		displayName: 'Tag ID',
		name: 'tagID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['tagAlias'],
				operation: ['delete'],
			},
		},
		description: 'ID of the tag that the alias belongs to',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {},
		required: true,
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
		displayOptions: {
			show: {
				resource: ['tagAlias'],
				operation: ['create', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
