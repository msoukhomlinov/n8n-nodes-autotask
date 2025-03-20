import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a service',
		action: 'Create a service',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a service',
		action: 'Update a service',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a service',
		action: 'Get a service',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many services',
		action: 'Get many services',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count services',
		action: 'Count services',
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
				resource: ['service'],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Service ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the service to operate on',
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
				resource: ['service'],
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

// Export baseFields directly - addOperationsToResource will be applied in Autotask.node.ts
export const serviceFields = baseFields;
