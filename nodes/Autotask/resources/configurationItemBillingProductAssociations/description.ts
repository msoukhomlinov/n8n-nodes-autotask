import type { INodeProperties } from 'n8n-workflow';

export const configurationItemBillingProductAssociationFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'configurationItemBillingProductAssociation',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a billing product association',
				action: 'Create a billing product association',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a billing product association',
				action: 'Update a billing product association',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a billing product association by ID',
				action: 'Get a billing product association',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple billing product associations',
				action: 'Get multiple billing product associations',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a billing product association',
				action: 'Delete a billing product association',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of billing product associations',
				action: 'Count billing product associations',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Billing Product Association ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['configurationItemBillingProductAssociation'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the billing product association to update, retrieve, or delete',
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
				resource: ['configurationItemBillingProductAssociation'],
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

export const entityFields = configurationItemBillingProductAssociationFields;
