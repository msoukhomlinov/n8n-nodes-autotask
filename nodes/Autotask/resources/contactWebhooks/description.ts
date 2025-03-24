import type { INodeProperties } from 'n8n-workflow';

export const contactWebhookFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contactWebhook',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contact webhook by ID',
				action: 'Get a contact webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contact webhooks',
				action: 'Get multiple contact webhooks',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contact webhook',
				action: 'Delete a contact webhook',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Webhook ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contactWebhook'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the webhook to operate on',
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
				resource: ['contactWebhook'],
				operation: ['getMany'],
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
