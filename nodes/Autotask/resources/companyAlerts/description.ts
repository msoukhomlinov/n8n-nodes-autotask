import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a company alert',
		action: 'Create a company alert',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a company alert',
		action: 'Update a company alert',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a company alert',
		action: 'Delete a company alert',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a company alert by ID',
		action: 'Get a company alert',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple company alerts using field filters',
		action: 'Get multiple company alerts',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of company alerts',
		action: 'Count company alerts',
	},
];

const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'companyAlert',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Company Alert ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['companyAlert'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the company alert to operate on',
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
				resource: ['companyAlert'],
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

export const companyAlertFields = baseFields;
