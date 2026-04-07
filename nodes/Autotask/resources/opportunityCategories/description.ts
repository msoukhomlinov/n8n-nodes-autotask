import type { INodeProperties } from 'n8n-workflow';

export const opportunityCategoryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['opportunityCategory'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get an opportunity category by ID',
				action: 'Get an opportunity category',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple opportunity categories',
				action: 'Get multiple opportunity categories',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count opportunity categories',
				action: 'Count opportunity categories',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update an opportunity category',
				action: 'Update an opportunity category',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Category ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunityCategory'],
				operation: ['get', 'update'],
			},
		},
		description: 'The ID of the opportunity category to operate on',
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
				resource: ['opportunityCategory'],
				operation: ['update', 'getMany', 'count'],
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
