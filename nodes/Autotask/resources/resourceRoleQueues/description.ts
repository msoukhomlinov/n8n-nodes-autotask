import type { INodeProperties } from 'n8n-workflow';

export const resourceRoleQueueFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['resourceRoleQueue'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Assign a resource to a queue',
				action: 'Create a resource role queue',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a resource queue assignment',
				action: 'Update a resource role queue',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a resource queue assignment by ID',
				action: 'Get a resource role queue',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple resource queue assignments using field filters',
				action: 'Get multiple resource role queues',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count resource queue assignments',
				action: 'Count resource role queues',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Resource Role Queue ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resourceRoleQueue'],
				operation: ['get', 'update'],
			},
		},
		description: 'The ID of the resource role queue record',
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
				resource: ['resourceRoleQueue'],
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
