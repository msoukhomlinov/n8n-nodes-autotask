import type { INodeProperties } from 'n8n-workflow';

export const projectTaskFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'task',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project task',
				action: 'Create a project task',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project task',
				action: 'Update a project task',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project task by ID',
				action: 'Get a project task',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple project tasks',
				action: 'Get multiple project tasks',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of project tasks',
				action: 'Count project tasks',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Project ID',
		name: 'projectID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['task'],
				operation: ['get'],
			},
		},
		description: 'The ID of the project this task belongs to',
	},
	{
		displayName: 'Task ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['task'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the task to update',
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
				resource: ['task'],
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
