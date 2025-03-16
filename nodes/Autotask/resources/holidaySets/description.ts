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
				operation: ['create', 'update', 'getMany', 'count'],
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
