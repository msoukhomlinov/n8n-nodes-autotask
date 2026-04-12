import type { INodeProperties } from 'n8n-workflow';

export const projectChargeFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'projectCharge',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project charge',
				action: 'Create a project charge',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project charge',
				action: 'Update a project charge',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a project charge',
				action: 'Delete a project charge',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project charge by ID',
				action: 'Get a project charge',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple project charges',
				action: 'Get multiple project charges',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of project charges',
				action: 'Count project charges',
			},
			{
				name: 'Create If Not Exists',
				value: 'createIfNotExists',
				description: 'Find project by ID or number, check for duplicates, create charge only if none found',
				action: 'Create a project charge if not exists',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Charge ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['projectCharge'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the charge to operate on',
	},
	// ─── createIfNotExists fields ────────────────────────────────────────
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['projectCharge'],
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
				resource: ['projectCharge'],
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
		displayName: 'Error On Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['projectCharge'],
				operation: ['createIfNotExists'],
			},
		},
		description: 'Whether to throw an error when a duplicate is found instead of returning it',
	},
	// ─── Standard CRUD fields ────────────────────────────────────────────
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
				resource: ['projectCharge'],
				operation: ['create', 'createIfNotExists', 'update', 'getMany', 'count'],
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
