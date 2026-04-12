import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a contract',
		action: 'Create a contract',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a contract',
		action: 'Update a contract',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a contract',
		action: 'Get a contract',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many contracts',
		action: 'Get many contracts',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count contracts',
		action: 'Count contracts',
	},
	{
		name: 'Create If Not Exists',
		value: 'createIfNotExists',
		description: 'Check for duplicate contracts within company scope, create only if none found',
		action: 'Create a contract if not exists',
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
				resource: ['contract'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Contract ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contract'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the contract to operate on',
	},
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['contract'],
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
				resource: ['contract'],
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
				resource: ['contract'],
				operation: ['createIfNotExists'],
			},
		},
		description: 'Whether to throw an error when a duplicate is found instead of returning it',
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
				resource: ['contract'],
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

export const contractFields = baseFields;