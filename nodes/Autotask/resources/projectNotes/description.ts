import type { INodeProperties } from 'n8n-workflow';

export const projectNoteFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'projectNote',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project note',
				action: 'Create a project note',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project note',
				action: 'Update a project note',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project note by ID',
				action: 'Get a project note',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple project notes',
				action: 'Get multiple project notes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of project notes',
				action: 'Count project notes',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Note ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['projectNote'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the note to update',
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
				resource: ['projectNote'],
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
