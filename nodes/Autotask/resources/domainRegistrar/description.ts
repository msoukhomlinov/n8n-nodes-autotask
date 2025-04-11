import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a domain registrar',
		action: 'Create a domain registrar',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a domain registrar',
		action: 'Update a domain registrar',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a domain registrar by ID',
		action: 'Get a domain registrar',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple domain registrars using field filters',
		action: 'Get multiple domain registrars',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of domain registrars',
		action: 'Count domain registrars',
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
					'DomainRegistrar',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Domain Registrar ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['DomainRegistrar'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the domain registrar to operate on',
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
				resource: ['DomainRegistrar'],
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

export const domainRegistrarFields = baseFields;
