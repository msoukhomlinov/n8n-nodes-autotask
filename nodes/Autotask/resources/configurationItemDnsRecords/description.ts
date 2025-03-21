import type { INodeProperties } from 'n8n-workflow';

export const configurationItemDnsRecordFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'configurationItemDnsRecord',
				],
			},
		},
		options: [
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a configuration item DNS record',
				action: 'Delete a configuration item DNS record',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a configuration item DNS record by ID',
				action: 'Get a configuration item DNS record',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple configuration item DNS records',
				action: 'Get multiple configuration item DNS records',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of configuration item DNS records',
				action: 'Count configuration item DNS records',
			},
		],
		default: 'get',
	},
	{
		displayName: 'DNS Record ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['configurationItemDnsRecord'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the DNS record to retrieve or delete',
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
				resource: ['configurationItemDnsRecord'],
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
