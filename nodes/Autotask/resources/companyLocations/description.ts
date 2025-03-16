import type { INodeProperties } from 'n8n-workflow';

export const companyLocationFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'companyLocation',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a company location',
				action: 'Create a company location',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a company location by ID',
				action: 'Get a company location',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many company locations',
				action: 'Get many company locations',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a company location',
				action: 'Update a company location',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a company location',
				action: 'Delete a company location',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count company locations',
				action: 'Count company locations',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Company Location ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['companyLocation'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the company location to operate on',
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
				resource: ['companyLocation'],
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
