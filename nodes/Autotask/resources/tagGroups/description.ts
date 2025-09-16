import type { INodeProperties } from 'n8n-workflow';

export const tagGroupFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'tagGroup',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a tag group',
				action: 'Create a tag group',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a tag group',
				action: 'Update a tag group',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a tag group',
				action: 'Delete a tag group',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a tag group by ID',
				action: 'Get a tag group',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple tag groups',
				action: 'Get multiple tag groups',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of tag groups',
				action: 'Count tag groups',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Tag Group ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['tagGroup'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the tag group to operate on',
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
				resource: ['tagGroup'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
