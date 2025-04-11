import { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a notification history record',
		action: 'Get a notification history record',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many notification history records',
		action: 'Get many notification history records',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count notification history records',
		action: 'Count notification history records',
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
				resource: ['notificationHistory'],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Notification History ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['notificationHistory'],
				operation: ['get'],
			},
		},
		description: 'The ID of the notification history record to retrieve',
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
				resource: ['notificationHistory'],
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
export const notificationHistoryFields = baseFields;
