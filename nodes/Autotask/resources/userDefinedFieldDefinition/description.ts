import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description:
			'Create a user-defined field definition (picklist = dataType List; udfType 1 = Company/Account)',
		action: 'Create a user-defined field definition',
	},
	{
		name: 'Update',
		value: 'update',
		description:
			'Update a user-defined field definition (use isActive=false for soft removal — the API has no delete)',
		action: 'Update a user-defined field definition',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a user-defined field definition by ID',
		action: 'Get a user-defined field definition',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple user-defined field definitions using field filters',
		action: 'Get multiple user-defined field definitions',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of user-defined field definitions',
		action: 'Count user-defined field definitions',
	},
];

export const userDefinedFieldDefinitionFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['userDefinedFieldDefinition'],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'User Defined Field Definition ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['userDefinedFieldDefinition'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the user-defined field definition to operate on',
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
				resource: ['userDefinedFieldDefinition'],
				operation: ['create', 'update', 'getMany', 'count'],
			},
		},
		description:
			'Map the fields to be used in the operation (dataType and udfType are immutable after creation)',
	},
];
