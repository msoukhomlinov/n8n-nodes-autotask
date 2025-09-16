import type { INodeProperties } from 'n8n-workflow';

export const tagFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'tag',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a tag',
				action: 'Create a tag',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a tag',
				action: 'Update a tag',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a tag',
				action: 'Delete a tag',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a tag by ID',
				action: 'Get a tag',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple tags',
				action: 'Get multiple tags',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of tags',
				action: 'Count tags',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Tag ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['tag'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the tag to operate on',
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
				resource: ['tag'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
