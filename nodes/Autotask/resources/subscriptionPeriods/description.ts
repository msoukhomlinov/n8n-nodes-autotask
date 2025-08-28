import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a subscription period by ID',
		action: 'Get a subscription period',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple subscription periods using field filters',
		action: 'Get multiple subscription periods',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of subscription periods',
		action: 'Count subscription periods',
	},
];

const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'subscriptionPeriod',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Subscription Period ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['subscriptionPeriod'],
				operation: ['get'],
			},
		},
		description: 'The ID of the subscription period to retrieve',
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
				resource: ['subscriptionPeriod'],
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

export const subscriptionPeriodsFields = baseFields;
