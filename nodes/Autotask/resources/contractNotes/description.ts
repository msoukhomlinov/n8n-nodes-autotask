import type { INodeProperties } from 'n8n-workflow';

export const contractNoteFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractNote',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract note',
				action: 'Create a contract note',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract note',
				action: 'Update a contract note',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract note by ID',
				action: 'Get a contract note',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract notes',
				action: 'Get multiple contract notes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract notes',
				action: 'Count contract notes',
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
				resource: ['contractNote'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the note to operate on',
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
				resource: ['contractNote'],
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
