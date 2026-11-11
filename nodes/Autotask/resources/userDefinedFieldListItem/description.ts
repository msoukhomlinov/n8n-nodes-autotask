import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a value for a picklist user-defined field (provide udfFieldId)',
		action: 'Create a user-defined field list item',
	},
	{
		name: 'Update',
		value: 'update',
		description:
			'Update a value of a picklist user-defined field (provide udfFieldId; use isActive=false for soft removal — the API has no delete)',
		action: 'Update a user-defined field list item',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a user-defined field list item by ID',
		action: 'Get a user-defined field list item',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description:
			'Get multiple user-defined field list items using field filters (filter by udfFieldId to select one definition)',
		action: 'Get multiple user-defined field list items',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of user-defined field list items',
		action: 'Count user-defined field list items',
	},
];

export const userDefinedFieldListItemFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['userDefinedFieldListItem'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'User Defined Field List Item ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['userDefinedFieldListItem'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the user-defined field list item to operate on',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {},
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
				resource: ['userDefinedFieldListItem'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description:
			'Map the fields to be used in the operation. For create/update include udfFieldId — the ID of the user-defined field definition that owns the value (parent-scoped). valueForDisplay and valueForExport are required and unique per definition.',
	},
];
