import type { INodeProperties } from 'n8n-workflow';

export const timeEntryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'timeEntry',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a time entry',
				action: 'Create a time entry',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a time entry',
				action: 'Update a time entry',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a time entry by ID',
				action: 'Get a time entry',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple time entries',
				action: 'Get multiple time entries',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a time entry',
				action: 'Delete a time entry',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of time entries',
				action: 'Count time entries',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Time Entry ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: [
					'timeEntry',
				],
				operation: [
					'update',
					'get',
					'delete',
				],
			},
		},
		description: 'The ID of the time entry to operate on',
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
				resource: [
					'timeEntry',
				],
				operation: [
					'create',
					'update',
					'getMany',
					'count',
				],
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
