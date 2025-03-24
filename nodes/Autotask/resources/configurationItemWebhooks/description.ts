import type { INodeProperties } from 'n8n-workflow';

export const configurationItemWebhookFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'configurationItemWebhook',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a configuration item webhook by ID',
				action: 'Get a configuration item webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple configuration item webhooks',
				action: 'Get multiple configuration item webhooks',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a configuration item webhook',
				action: 'Delete a configuration item webhook',
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
				resource: ['configurationItemWebhook'],
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
				resource: ['configurationItemWebhook'],
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
