import type { INodeProperties } from 'n8n-workflow';

export const checklistLibraryChecklistItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'checklistLibraryChecklistItem',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a checklist library item',
				action: 'Create a checklist library item',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a checklist library item',
				action: 'Update a checklist library item',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a checklist library item',
				action: 'Delete a checklist library item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a checklist library item by ID',
				action: 'Get a checklist library item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple checklist library items',
				action: 'Get multiple checklist library items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of checklist library items',
				action: 'Count checklist library items',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['checklistLibraryChecklistItem'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the checklist library item to operate on',
	},
	{
		displayName: 'Checklist Library ID',
		name: 'checklistLibraryID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['checklistLibraryChecklistItem'],
				operation: ['delete'],
			},
		},
		description: 'ID of the checklist library that the item belongs to',
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
				resource: ['checklistLibraryChecklistItem'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
