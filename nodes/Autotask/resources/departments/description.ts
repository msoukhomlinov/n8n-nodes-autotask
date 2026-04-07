import type { INodeProperties } from 'n8n-workflow';

export const departmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['department'],
			},
		},
		options: [
			{
				name: 'Count',
				value: 'count',
				description: 'Count departments',
				action: 'Count departments',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a department',
				action: 'Create a department',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a department by ID',
				action: 'Get a department',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many departments',
				action: 'Get many departments',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a department',
				action: 'Update a department',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Department ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['department'],
				operation: ['get', 'update'],
			},
		},
		description: 'The ID of the department to retrieve or update',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		displayOptions: { show: { resource: ['department'], operation: ['create', 'update', 'getMany', 'count'] } },
		typeOptions: {
			loadOptionsDependsOn: ['resource', 'operation'],
			resourceMapper: {
				resourceMapperMethod: 'getFields',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: false,
				multiKeyMatch: true,
				supportAutoMap: true,
			},
		},
	},
];
