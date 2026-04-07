import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a holiday set',
		action: 'Create a holiday set',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a holiday set',
		action: 'Update a holiday set',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a holiday set by ID',
		action: 'Get a holiday set',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple holiday sets using field filters',
		action: 'Get multiple holiday sets',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a holiday set',
		action: 'Delete a holiday set',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of holiday sets',
		action: 'Count holiday sets',
	},
	{
		name: 'Create If Not Exists',
		value: 'createIfNotExists',
		description: 'Create a holiday set only if one with matching fields does not already exist',
		action: 'Create a holiday set if not exists',
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
					'holidaySet',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Holiday Set ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['holidaySet'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the holiday set to operate on',
	},
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['holidaySet'],
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
				resource: ['holidaySet'],
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
		displayName: 'Error On Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['holidaySet'],
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
				resource: ['holidaySet'],
				operation: ['create', 'update', 'getMany', 'count', 'createIfNotExists'],
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

export const holidaySetFields = baseFields;
