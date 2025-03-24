import type { INodeProperties } from 'n8n-workflow';

export const companyWebhookFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'companyWebhook',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a company webhook by ID',
				action: 'Get a company webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple company webhooks',
				action: 'Get multiple company webhooks',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a company webhook',
				action: 'Delete a company webhook',
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
				resource: ['companyWebhook'],
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
				resource: ['companyWebhook'],
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
