import type { INodeProperties } from 'n8n-workflow';

export const timeEntryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'timeEntry',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a time entry',
				action: 'Create a time entry',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a time entry',
				action: 'Update a time entry',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a time entry by ID',
				action: 'Get a time entry',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple time entries',
				action: 'Get multiple time entries',
			},
			{
				name: 'Get Posted',
				value: 'getPosted',
				description: 'Get time entries that have been approved and posted (have a matching BillingItem)',
				action: 'Get posted time entries',
			},
			{
				name: 'Get Unposted',
				value: 'getUnposted',
				description: 'Get time entries that have NOT been approved and posted (no matching BillingItem)',
				action: 'Get unposted time entries',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a time entry',
				action: 'Delete a time entry',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of time entries',
				action: 'Count time entries',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Time Entry ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: [
					'timeEntry',
				],
				operation: [
					'update',
					'get',
					'delete',
				],
			},
		},
		description: 'The ID of the time entry to operate on',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: {
				resource: ['timeEntry'],
				operation: ['getUnposted', 'getPosted'],
			},
		},
		options: [
			{
				displayName: 'Account Manager Name or ID',
				name: 'accountManagerFilter',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getResourceOptions',
				},
				description: 'Filter by the ownerResourceID on the parent Company. Requires multiple cross-entity lookups and may be noticeably slower on large datasets. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Billable Status',
				name: 'billableFilter',
				type: 'options',
				default: 0,
				options: [
					{
						name: 'All',
						value: 0,
						description: 'Return both billable and non-billable entries',
					},
					{
						name: 'Billable Only',
						value: 1,
						description: 'Only entries where isNonBillable is false',
					},
					{
						name: 'Non-Billable Only',
						value: 2,
						description: 'Only entries where isNonBillable is true',
					},
				],
				description: 'Filter by billable status',
			},
			{
				displayName: 'Contract Type Name or ID',
				name: 'contractTypeFilter',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getContractTypes',
				},
				description: 'Filter by contract type. Requires an extra API call to look up contracts. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Date From',
				name: 'dateFrom',
				type: 'dateTime',
				default: '',
				description: 'Start of the custom date range (inclusive). Only used when Date Range is set to "Custom Range".',
			},
			{
				displayName: 'Date Range',
				name: 'dateRange',
				type: 'options',
				default: '',
				description: 'Filter time entries by the dateWorked field',
				options: [
					{ name: 'Any Time', value: '', description: 'No date filter' },
					{ name: 'Custom Range', value: 'customRange', description: 'Specify From/To dates below' },
					{ name: 'Last 14 Days', value: 'last14', description: 'Rolling 14 days from now' },
					{ name: 'Last 24 Hours', value: 'last24h', description: 'Rolling 24 hours from now' },
					{ name: 'Last 30 Days', value: 'last30', description: 'Rolling 30 days from now' },
					{ name: 'Last 7 Days', value: 'last7', description: 'Rolling 7 days from now' },
					{ name: 'Last 90 Days', value: 'last90', description: 'Rolling 90 days from now' },
					{ name: 'Last Full Fortnight', value: 'lastFullFortnight', description: 'Mon–Sun of the previous two complete weeks' },
					{ name: 'Last Full Month', value: 'lastFullMonth', description: '1st to last day of the previous complete month' },
					{ name: 'Last Full Quarter', value: 'lastFullQuarter', description: 'Previous complete calendar quarter' },
					{ name: 'Last Full Week', value: 'lastFullWeek', description: 'Mon–Sun of the previous complete week' },
					{ name: 'Today', value: 'today', description: 'Start of today to now' },
					{ name: 'Yesterday', value: 'yesterday', description: 'Full day yesterday' },
				],
			},
			{
				displayName: 'Date To',
				name: 'dateTo',
				type: 'dateTime',
				default: '',
				description: 'End of the custom date range (inclusive). Only used when Date Range is set to "Custom Range".',
			},
			{
				displayName: 'Maximum Hours',
				name: 'hoursWorkedMax',
				type: 'string',
				default: '',
				placeholder: 'e.g. 8',
				description: 'Only return entries with hoursWorked less than or equal to this value. Leave empty to skip.',
			},
			{
				displayName: 'Minimum Hours',
				name: 'hoursWorkedMin',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1.5',
				description: 'Only return entries with hoursWorked greater than or equal to this value. Leave empty to skip.',
			},
			{
				displayName: 'Queue Name or ID',
				name: 'queueFilter',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getQueueOptions',
				},
				description: 'Filter by Ticket queue. Only ticket time entries assigned to this queue are returned. Requires extra API calls. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Resource Name or ID',
				name: 'resourceFilter',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getResourceOptions',
				},
				description: 'Filter by the technician who logged the time. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Task Status Names or IDs',
				name: 'taskStatusFilter',
				type: 'multiOptions',
				default: [],
				typeOptions: {
					loadOptionsMethod: 'getTaskStatuses',
				},
				description: 'Only task time entries whose parent task matches one of these statuses are returned. Requires extra API calls. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Ticket Status Names or IDs',
				name: 'ticketStatusFilter',
				type: 'multiOptions',
				default: [],
				typeOptions: {
					loadOptionsMethod: 'getTicketStatuses',
				},
				description: 'Only ticket time entries whose parent ticket matches one of these statuses are returned. Requires extra API calls. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Time Entry Type',
				name: 'timeEntryTypeFilter',
				type: 'options',
				default: 0,
				options: [
					{
						name: 'All Types',
						value: 0,
						description: 'Return all time entry types',
					},
					{
						name: 'Task Time',
						value: 6,
						description: 'Only project task time entries (ProjectTask)',
					},
					{
						name: 'Ticket Time',
						value: 2,
						description: 'Only ticket time entries (ITServiceRequest)',
					},
				],
				description: 'Filter by time entry type',
			},
		],
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
				resource: [
					'timeEntry',
				],
				operation: [
					'create',
					'update',
					'getMany',
					'getUnposted',
					'getPosted',
					'count',
				],
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
