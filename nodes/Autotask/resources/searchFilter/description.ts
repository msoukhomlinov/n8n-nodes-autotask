import type { INodeProperties } from 'n8n-workflow';

export const searchFilterDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['searchFilter'],
			},
		},
		options: [
			{
				name: 'Build',
				value: 'build',
				description: 'Build a search filter for Autotask API queries',
				action: 'Build a search filter',
			},
			{
				name: 'Dynamic Build',
				value: 'dynamicBuild',
				description: 'Build a search filter with dynamic field selection based on entity type',
				action: 'Build a dynamic search filter',
			},
		],
		default: 'build',
	},
	{
		displayName: 'Entity Type Name or ID',
		name: 'entityType',
		type: 'options',
		required: true,
		displayOptions: {
			show: {
				resource: ['searchFilter'],
				operation: ['dynamicBuild'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getQueryableEntities',
		},
		default: '',
		description: 'The entity type to build a filter for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
];

export const searchFilterOperations: INodeProperties[] = [
	{
		displayName: 'Filter Groups',
		name: 'filter',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				resource: ['searchFilter'],
				operation: ['build', 'dynamicBuild'],
			},
		},
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		placeholder: 'Add Filter Group',
		default: { group: [] },
		description: 'Build filter groups for Autotask API queries. IMPORTANT: You can only query by one user-defined field (UDF) at a time.',
		options: [
			{
				displayName: 'Group',
				name: 'group',
				values: [
					{
						displayName: 'Logical Operator',
						name: 'op',
						type: 'options',
						options: [
							{ name: 'AND', value: 'and' },
							{ name: 'OR', value: 'or' },
						],
						default: 'and',
					},
					{
						displayName: 'Conditions',
						name: 'items',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
							sortable: true,
						},
						placeholder: 'Add Condition',
						default: { itemType: [] },
						options: [
							{
								displayName: 'Item',
								name: 'itemType',
								values: [
									{
										displayName: 'Field Name',
										name: 'field',
										type: 'string',
										default: '',
										description: 'API field name or UDF field name',
										displayOptions: {
											show: {
												'/operation': ['build'],
											},
										},
									},
									{
										displayName: 'Field Name or ID',
										name: 'field',
										type: 'options',
										typeOptions: {
											loadOptionsMethod: 'getEntityFields',
											loadOptionsDependsOn: ['entityType'],
										},
										default: '',
										description: 'Select a field from the entity. UDF fields are prefixed with "UDF:". Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
										displayOptions: {
											show: {
												'/operation': ['dynamicBuild'],
											},
										},
									},
									{
										displayName: 'Operator',
										name: 'op',
										type: 'options',
										options: [
											{ name: 'Equals', value: 'eq' },
											{ name: 'Not Equals', value: 'noteq' },
											{ name: 'Greater Than', value: 'gt' },
											{ name: 'Greater Than or Equal', value: 'gte' },
											{ name: 'Less Than', value: 'lt' },
											{ name: 'Less Than or Equal', value: 'lte' },
											{ name: 'Begins With', value: 'beginsWith' },
											{ name: 'Ends With', value: 'endsWith' },
											{ name: 'Contains', value: 'contains' },
											{ name: 'Exists', value: 'exist' },
											{ name: 'Not Exists', value: 'notExist' },
											{ name: 'In List', value: 'in' },
											{ name: 'Not In List', value: 'notIn' },
										],
										default: 'eq',
									},
									{
										displayName: 'Value Type',
										name: 'valueType',
										type: 'options',
										options: [
											{ name: 'String', value: 'string' },
											{ name: 'Number', value: 'number' },
											{ name: 'Boolean', value: 'boolean' },
											{ name: 'Date', value: 'date' },
										],
										default: 'string',
										description: 'The type of value to be compared',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description: 'For boolean values, use "true" or "false"',
										displayOptions: {
											hide: {
												valueType: ['date', 'boolean'],
											},
										},
									},
									{
										displayName: 'Date Value',
										name: 'dateValue',
										type: 'dateTime',
										default: '',
										description: 'The date to be compared. Will be converted to UTC if timezone is configured in credentials.',
										displayOptions: {
											show: {
												valueType: ['date'],
											},
										},
									},
									{
										displayName: 'Is in UTC?',
										name: 'isUtc',
										type: 'boolean',
										default: false,
										description: 'Whether the provided date is already in UTC. If false, it will be converted from the configured local timezone to UTC.',
										displayOptions: {
											show: {
												valueType: ['date'],
											},
										},
									},
									{
										displayName: 'Boolean Value',
										name: 'booleanValue',
										type: 'boolean',
										default: false,
										description: 'Whether the condition should match true or false',
										displayOptions: {
											show: {
												valueType: ['boolean'],
											},
										},
									},
									{
										displayName: 'Is UDF?',
										name: 'udf',
										type: 'boolean',
										default: false,
									},
								],
							}
						],
					}
				],
			}
		],
	},
];
