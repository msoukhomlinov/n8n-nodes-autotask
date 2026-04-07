import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create an expense item',
		action: 'Create an expense item',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update an expense item',
		action: 'Update an expense item',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get an expense item',
		action: 'Get an expense item',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get many expense items',
		action: 'Get many expense items',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count expense items',
		action: 'Count expense items',
	},
	{
		name: 'Create If Not Exists',
		value: 'createIfNotExists',
		description: 'Check for duplicate expense items within an expense report, create only if none found',
		action: 'Create an expense item if not exists',
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
				resource: ['expenseItem'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Expense Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['expenseItem'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the expense item to operate on',
	},
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['expenseItem'],
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
		displayName: 'Error On Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['expenseItem'],
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
				resource: ['expenseItem'],
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

export const expenseItemFields = baseFields;
