import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create an opportunity',
		action: 'Create an opportunity',
	},
	{
		name: 'Create If Not Exists',
		value: 'createIfNotExists',
		description: 'Check for a duplicate opportunity within company scope, create only if none found',
		action: 'Create an opportunity if not exists',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update an opportunity',
		action: 'Update an opportunity',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get an opportunity by ID',
		action: 'Get an opportunity',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many opportunities',
		action: 'Get many opportunities',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count opportunities',
		action: 'Count opportunities',
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
				resource: ['opportunity'],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Opportunity ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunity'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the opportunity to operate on',
	},
	// ─── createIfNotExists fields ─────────────────────────────────────────
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['opportunity'],
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
				resource: ['opportunity'],
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
				resource: ['opportunity'],
				operation: ['createIfNotExists'],
			},
		},
		description: 'Whether to throw an error when a duplicate is found instead of returning it',
	},
	// ─── Standard CRUD fields ─────────────────────────────────────────────
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
				resource: ['opportunity'],
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

export const opportunityFields = baseFields;
