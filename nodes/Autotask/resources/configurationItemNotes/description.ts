import type { INodeProperties } from 'n8n-workflow';

export const configurationItemNoteFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'configurationItemNote',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a configuration item note',
				action: 'Create a configuration item note',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a configuration item note',
				action: 'Update a configuration item note',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a configuration item note by ID',
				action: 'Get a configuration item note',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple configuration item notes',
				action: 'Get multiple configuration item notes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of configuration item notes',
				action: 'Count configuration item notes',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Note ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['configurationItemNote'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the note to update or retrieve',
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
				resource: ['configurationItemNote'],
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
