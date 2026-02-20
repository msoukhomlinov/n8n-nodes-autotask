import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a company',
		action: 'Create a company',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a company',
		action: 'Update a company',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a company by ID',
		action: 'Get a company',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple companies using field filters',
		action: 'Get multiple companies',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of companies',
		action: 'Count companies',
	},
	{
		name: 'Search by Domain',
		value: 'searchByDomain',
		description: 'Search companies by website domain with optional contact-email fallback',
		action: 'Search companies by domain',
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
					'company',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Company ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the company to operate on',
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
				resource: ['company'],
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
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByDomain'],
			},
		},
		description: 'Domain to search for, for example autotask.net',
	},
	{
		displayName: 'Domain Operator',
		name: 'domainOperator',
		type: 'options',
		default: 'contains',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByDomain'],
			},
		},
		options: [
			{
				name: 'Contains',
				value: 'contains',
			},
			{
				name: 'Equals',
				value: 'eq',
			},
			{
				name: 'Begins With',
				value: 'beginsWith',
			},
			{
				name: 'Ends With',
				value: 'endsWith',
			},
			{
				name: 'Like (Alias of Contains)',
				value: 'like',
			},
		],
		description: 'Operator to apply to the domain search value',
	},
	{
		displayName: 'Search Contact Emails',
		name: 'searchContactEmails',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByDomain'],
			},
		},
		description: 'Whether to search contacts by email domain when no company website matches are found',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: {
			minValue: 1,
			numberPrecision: 0,
		},
		default: 25,
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByDomain'],
			},
		},
		description: 'Maximum number of matching companies to include in the results array of the returned object',
	},
];

export const companyFields = baseFields;
