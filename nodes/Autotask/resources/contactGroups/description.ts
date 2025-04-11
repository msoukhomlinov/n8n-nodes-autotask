import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a contact group',
		action: 'Create a contact group',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a contact group',
		action: 'Update a contact group',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a contact group by ID',
		action: 'Get a contact group',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple contact groups using field filters',
		action: 'Get multiple contact groups',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a contact group',
		action: 'Delete a contact group',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of contact groups',
		action: 'Count contact groups',
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
					'contactGroups',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Contact Group ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contactGroups'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the contact group to operate on',
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
				resource: ['contactGroups'],
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

export const contactGroupsFields = baseFields;
