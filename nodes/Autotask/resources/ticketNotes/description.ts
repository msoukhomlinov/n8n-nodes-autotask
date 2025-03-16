import type { INodeProperties } from 'n8n-workflow';

export const ticketNoteFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketNote',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a ticket note',
				action: 'Create a ticket note',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a ticket note',
				action: 'Update a ticket note',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket note by ID',
				action: 'Get a ticket note',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket notes',
				action: 'Get multiple ticket notes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of ticket notes',
				action: 'Count ticket notes',
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
				resource: ['ticketNote'],
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
				resource: ['ticketNote'],
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
