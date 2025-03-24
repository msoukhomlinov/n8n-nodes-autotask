import type { INodeProperties } from 'n8n-workflow';

export const ticketNoteWebhookFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketNoteWebhook',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket note webhook by ID',
				action: 'Get a ticket note webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket note webhooks',
				action: 'Get multiple ticket note webhooks',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a ticket note webhook',
				action: 'Delete a ticket note webhook',
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
				resource: ['ticketNoteWebhook'],
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
				resource: ['ticketNoteWebhook'],
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
