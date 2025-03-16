import type { INodeProperties } from 'n8n-workflow';

export const holidayFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'holiday',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a holiday',
				action: 'Create a holiday',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a holiday',
				action: 'Update a holiday',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a holiday by ID',
				action: 'Get a holiday',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple holidays',
				action: 'Get multiple holidays',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of holidays',
				action: 'Count holidays',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a holiday',
				action: 'Delete a holiday',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Holiday ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['holiday'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the holiday to operate on',
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
				resource: ['holiday'],
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
