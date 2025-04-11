import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a contact group contact',
		action: 'Create a contact group contact',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a contact group contact by ID',
		action: 'Get a contact group contact',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple contact group contacts using field filters',
		action: 'Get multiple contact group contacts',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a contact group contact',
		action: 'Delete a contact group contact',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of contact group contacts',
		action: 'Count contact group contacts',
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
					'contactGroupContacts',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Contact Group Contact ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contactGroupContacts'],
				operation: ['get', 'delete'],
			},
		},
		description: 'The ID of the contact group contact to operate on',
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
				resource: ['contactGroupContacts'],
				operation: ['create', 'getMany', 'count'],
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

export const contactGroupContactsFields = baseFields;
