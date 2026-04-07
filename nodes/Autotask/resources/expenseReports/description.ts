import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create an expense report',
		action: 'Create an expense report',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update an expense report',
		action: 'Update an expense report',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get an expense report',
		action: 'Get an expense report',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many expense reports',
		action: 'Get many expense reports',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count expense reports',
		action: 'Count expense reports',
	},
];

export const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['expenseReport'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Expense Report ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['expenseReport'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the expense report to operate on',
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
				resource: ['expenseReport'],
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

export const expenseReportFields = baseFields;
