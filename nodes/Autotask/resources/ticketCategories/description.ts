import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a ticket category',
		action: 'Get a ticket category',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many ticket categories',
		action: 'Get many ticket categories',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a ticket category',
		action: 'Update a ticket category',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count ticket categories',
		action: 'Count ticket categories',
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
				resource: ['ticketCategory'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Ticket Category ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketCategory'],
				operation: ['get', 'update'],
			},
		},
		description: 'The ID of the ticket category to operate on',
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
				resource: ['ticketCategory'],
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
export const ticketCategoryFields = baseFields;
