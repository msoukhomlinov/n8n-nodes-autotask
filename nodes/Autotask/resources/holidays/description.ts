import type { INodeProperties } from 'n8n-workflow';

export const holidayFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'holiday',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a holiday',
				action: 'Create a holiday',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a holiday',
				action: 'Update a holiday',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a holiday by ID',
				action: 'Get a holiday',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple holidays',
				action: 'Get multiple holidays',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of holidays',
				action: 'Count holidays',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a holiday',
				action: 'Delete a holiday',
			},
			{
				name: 'Create If Not Exists',
				value: 'createIfNotExists',
				description: 'Create a holiday only if one with matching fields does not already exist in the holiday set',
				action: 'Create a holiday if not exists',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Holiday ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['holiday'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the holiday to operate on',
	},
	{
		displayName: 'Holiday Set ID',
		name: 'holidaySetID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['holiday'],
				operation: ['delete'],
			},
		},
		description: 'The ID of the parent holiday set — required to build the delete URL',
	},
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: {
			show: {
				resource: ['holiday'],
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
				resource: ['holiday'],
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
				resource: ['holiday'],
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
				resource: ['holiday'],
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
