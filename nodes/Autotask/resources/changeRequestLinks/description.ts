import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
	{ name: 'Create', value: 'create', description: 'Link a Change Request ticket to a Problem or Incident ticket', action: 'Create a change request link' },
	{ name: 'Create If Not Exists', value: 'createIfNotExists', description: 'Link a Change Request ticket to a Problem or Incident ticket only if the link does not already exist', action: 'Create a change request link if not exists' },
	{ name: 'Delete', value: 'delete', description: 'Remove a link between a Change Request and a Problem or Incident ticket', action: 'Delete a change request link' },
	{ name: 'Get', value: 'get', description: 'Get a change request link record by ID', action: 'Get a change request link' },
	{ name: 'Get Many', value: 'getMany', description: 'Get multiple change request link records', action: 'Get many change request links' },
	{ name: 'Count', value: 'count', description: 'Count change request link records', action: 'Count change request links' },
];

export const baseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['changeRequestLink'] } },
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Change Request Link ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['changeRequestLink'], operation: ['get', 'delete'] } },
		description: 'The ID of the change request link record',
	},
	// createIfNotExists fields
	{
		displayName: 'Dedup Fields Names or IDs',
		name: 'dedupFields',
		type: 'multiOptions',
		default: [],
		displayOptions: { show: { resource: ['changeRequestLink'], operation: ['createIfNotExists'] } },
		typeOptions: { loadOptionsMethod: 'getSelectColumns', loadOptionsDependsOn: ['resource'] },
		description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Fields used for duplicate detection. Defaults to both ticket ID fields. Empty = skip dedup, always create.',
	},
	{
		displayName: 'Error on Duplicate',
		name: 'errorOnDuplicate',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['changeRequestLink'], operation: ['createIfNotExists'] } },
		description: 'Whether to throw an error when a duplicate link is found',
	},
	// fieldsToMap for create, createIfNotExists, getMany, count
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['resource', 'operation'],
			resourceMapper: {
				resourceMapperMethod: 'getFields',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: false,
				multiKeyMatch: true,
				supportAutoMap: true,
			},
		},
		displayOptions: { show: { resource: ['changeRequestLink'], operation: ['create', 'createIfNotExists', 'getMany', 'count'] } },
		description: 'Map the fields to be used in the operation',
	},
];

export const changeRequestLinkFields = baseFields;
