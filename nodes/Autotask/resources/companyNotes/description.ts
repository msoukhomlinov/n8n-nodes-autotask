import type { INodeProperties } from 'n8n-workflow';

export const companyNoteFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'companyNote',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a company note',
				action: 'Create a company note',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a company note',
				action: 'Update a company note',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a company note by ID',
				action: 'Get a company note',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple company notes',
				action: 'Get multiple company notes',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of company notes',
				action: 'Count company notes',
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
				resource: ['companyNote'],
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
				resource: ['companyNote'],
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
