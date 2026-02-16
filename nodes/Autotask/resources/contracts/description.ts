import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a contract',
		action: 'Create a contract',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a contract',
		action: 'Update a contract',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a contract',
		action: 'Get a contract',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many contracts',
		action: 'Get many contracts',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count contracts',
		action: 'Count contracts',
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
				resource: ['contract'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Contract ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contract'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract to operate on',
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
				resource: ['contract'],
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

export const contractFields = baseFields;