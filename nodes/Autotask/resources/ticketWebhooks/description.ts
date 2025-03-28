import type { INodeProperties } from 'n8n-workflow';

export const ticketWebhookFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketWebhook',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket webhook by ID',
				action: 'Get a ticket webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket webhooks',
				action: 'Get multiple ticket webhooks',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a ticket webhook',
				action: 'Delete a ticket webhook',
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
				resource: ['ticketWebhook'],
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
				resource: ['ticketWebhook'],
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
