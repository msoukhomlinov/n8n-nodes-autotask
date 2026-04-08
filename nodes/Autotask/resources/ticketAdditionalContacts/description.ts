import type { INodeProperties } from 'n8n-workflow';

export const ticketAdditionalContactFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['ticketAdditionalContact'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Associate an additional contact with a ticket',
				action: 'Create a ticket additional contact',
			},
			{
				name: 'Create If Not Exists',
				value: 'createIfNotExists',
				description: 'Check if the contact is already linked to the ticket, create only if not',
				action: 'Create a ticket additional contact if not exists',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove an additional contact association from a ticket',
				action: 'Delete a ticket additional contact',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a ticket additional contact by ID',
				action: 'Get a ticket additional contact',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket additional contacts',
				action: 'Get multiple ticket additional contacts',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count ticket additional contacts',
				action: 'Count ticket additional contacts',
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
				resource: ['ticketAdditionalContact'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the ticket additional contact association to operate on',
	},
	{
		displayName: 'Ticket ID',
		name: 'ticketID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketAdditionalContact'],
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
				resource: ['ticketAdditionalContact'],
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
				resource: ['ticketAdditionalContact'],
				operation: ['createIfNotExists'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getSelectColumns',
			loadOptionsDependsOn: ['resource'],
		},
		description: 'Choose from the list, or specify IDs using an expression',
		hint: 'Fields to compare against the duplicate. If values differ, the duplicate will be updated. Ignored when "Error on Duplicate" is enabled.',
	},
	{
		displayName: 'Error on Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['ticketAdditionalContact'],
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
				resource: ['ticketAdditionalContact'],
				operation: ['create', 'createIfNotExists', 'getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
