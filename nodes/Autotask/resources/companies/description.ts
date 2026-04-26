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
		name: 'Search by Identity',
		value: 'searchByIdentity',
		description:
			'Preferred AI search: resolve companies using company name, email, website/domain, and ranking',
		action: 'Search companies by identity',
	},
	{
		name: 'Search by Domain',
		value: 'searchByDomain',
		description:
			'Legacy search by website domain with optional contact-email fallback (searchByIdentity is preferred)',
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
		displayName: 'Company Name',
		name: 'companyName',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByIdentity'],
			},
		},
		description: 'Optional company name to match (contains search)',
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByIdentity'],
			},
		},
		description: 'Optional email used to infer domain (for example person@autotask.net)',
	},
	{
		displayName: 'Website/Domain',
		name: 'website',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByIdentity'],
			},
		},
		description: 'Optional website or domain (for example https://www.autotask.net)',
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
		default: 50,
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['searchByDomain', 'searchByIdentity'],
			},
		},
		description: 'Max number of results to return',
	},
];

export const companyFields = baseFields;
