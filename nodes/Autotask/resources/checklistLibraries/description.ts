import type { INodeProperties } from 'n8n-workflow';

export const checklistLibraryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'checklistLibrary',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a checklist library',
				action: 'Create a checklist library',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a checklist library',
				action: 'Update a checklist library',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a checklist library',
				action: 'Delete a checklist library',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a checklist library by ID',
				action: 'Get a checklist library',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple checklist libraries',
				action: 'Get multiple checklist libraries',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of checklist libraries',
				action: 'Count checklist libraries',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Library ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['checklistLibrary'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the checklist library to operate on',
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
				resource: ['checklistLibrary'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
