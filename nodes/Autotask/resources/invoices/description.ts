import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Update',
		value: 'update',
		description: 'Update an invoice',
		action: 'Update an invoice',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get an invoice',
		action: 'Get an invoice',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many invoices',
		action: 'Get many invoices',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count invoices',
		action: 'Count invoices',
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
				resource: ['invoice'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Invoice ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['invoice'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the invoice to operate on',
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
				resource: ['invoice'],
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

// Export baseFields directly - addOperationsToResource will be applied in Autotask.node.ts
export const invoiceFields = baseFields;
