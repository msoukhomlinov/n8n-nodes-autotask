import type { INodeProperties } from 'n8n-workflow';

export const configurationItemRelatedItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'configurationItemRelatedItem',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a configuration item related item',
				action: 'Create a configuration item related item',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a configuration item related item',
				action: 'Delete a configuration item related item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a configuration item related item by ID',
				action: 'Get a configuration item related item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple configuration item related items',
				action: 'Get multiple configuration item related items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of configuration item related items',
				action: 'Count configuration item related items',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Related Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['configurationItemRelatedItem'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the related item to retrieve or delete',
	},
	{
		// v2.29.0 (PR #148 R2, C1b): the Autotask API exposes related-item deletion
		// only via the parent-scoped path
		// (DELETE ConfigurationItems/{configurationItemID}/RelatedItems/{id});
		// DeleteOperation needs configurationItemID to build that URL.
		displayName: 'Configuration Item ID',
		name: 'configurationItemID',
		type: 'string',
		required: true,
		default: '',
		displayOptions:
		{
			show: {
				resource: ['configurationItemRelatedItem'],
				operation: ['delete'],
			},
		},
		description:
			'Required (parent configuration item numeric ID or name) — the Autotask API only exposes related-item deletion via the parent-scoped path (ConfigurationItems/{configurationItemID}/RelatedItems/{ID})',
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
				resource: ['configurationItemRelatedItem'],
				operation: ['create', 'getMany', 'count'],
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
