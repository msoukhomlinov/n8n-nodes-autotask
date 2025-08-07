import type { INodeProperties } from 'n8n-workflow';

export const companySiteConfigurationFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'companySiteConfiguration',
				],
			},
		},
		options: [
			{
				name: 'Update',
				value: 'update',
				description: 'Update a company site configuration',
				action: 'Update a company site configuration',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a company site configuration by ID',
				action: 'Get a company site configuration',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple company site configurations',
				action: 'Get multiple company site configurations',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of company site configurations',
				action: 'Count company site configurations',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Configuration ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['companySiteConfiguration'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the site configuration to update',
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
				resource: ['companySiteConfiguration'],
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
