import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create an opportunity',
		action: 'Create an opportunity',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update an opportunity',
		action: 'Update an opportunity',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get an opportunity',
		action: 'Get an opportunity',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many opportunities',
		action: 'Get many opportunities',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count opportunities',
		action: 'Count opportunities',
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
				resource: ['opportunity'],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Opportunity ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunity'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the opportunity to operate on',
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
				resource: ['opportunity'],
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

export const opportunityFields = baseFields;
