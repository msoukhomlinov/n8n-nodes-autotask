import type { INodeProperties } from 'n8n-workflow';

export const ticketAdditionalConfigurationItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Associate an additional configuration item with a ticket',
				action: 'Create a ticket additional configuration item',
			},
			{
				name: 'Create If Not Exists',
				value: 'createIfNotExists',
				description: 'Check if the CI is already linked to the ticket, create only if not',
				action: 'Create a ticket additional configuration item if not exists',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove an additional configuration item association from a ticket',
				action: 'Delete a ticket additional configuration item',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket additional configuration item by ID',
				action: 'Get a ticket additional configuration item',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket additional configuration items',
				action: 'Get multiple ticket additional configuration items',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count ticket additional configuration items',
				action: 'Count ticket additional configuration items',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Association ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the ticket additional configuration item association to operate on',
	},
	{
		displayName: 'Ticket ID',
		name: 'ticketID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['delete'],
			},
		},
		description: 'The numeric ID of the parent ticket',
	},
	// ─── createIfNotExists fields ─────────────────────────────────────────
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['createIfNotExists'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getSelectColumns',
			loadOptionsDependsOn: ['resource'],
		},
		description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Fields used for duplicate detection. Empty = skip dedup, always create.',
	},
	{
		displayName: 'Update Fields Names or IDs',
		name: 'updateFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['createIfNotExists'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getSelectColumns',
			loadOptionsDependsOn: ['resource'],
		},
		description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Fields to compare against the duplicate. If values differ, the duplicate will be updated. Ignored when "Error on Duplicate" is enabled.',
	},
	{
		displayName: 'Error on Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['createIfNotExists'],
			},
		},
		description: 'Whether to throw an error when a duplicate is found',
	},
	// ─── Standard CRUD fields ─────────────────────────────────────────────
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
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
		displayOptions: {
			show: {
				resource: ['ticketAdditionalConfigurationItem'],
				operation: ['create', 'createIfNotExists', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
