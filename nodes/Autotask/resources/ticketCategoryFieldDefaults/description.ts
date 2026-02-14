import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a ticket category field default',
		action: 'Get a ticket category field default',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many ticket category field defaults',
		action: 'Get many ticket category field defaults',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count ticket category field defaults',
		action: 'Count ticket category field defaults',
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
				resource: ['ticketCategoryFieldDefault'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Ticket Category Field Default ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketCategoryFieldDefault'],
				operation: ['get'],
			},
		},
		description: 'The ID of the ticket category field default to retrieve',
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
				resource: ['ticketCategoryFieldDefault'],
				operation: ['getMany', 'count'],
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
export const ticketCategoryFieldDefaultFields = baseFields;
