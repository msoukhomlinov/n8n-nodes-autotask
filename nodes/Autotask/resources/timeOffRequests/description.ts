import type { INodeProperties } from 'n8n-workflow';

export const timeOffRequestFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'timeOffRequest',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a time off request by ID',
				action: 'Get a time off request',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple time off requests',
				action: 'Get multiple time off requests',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of time off requests',
				action: 'Count time off requests',
			},
			{
				name: 'Approve',
				value: 'approve',
				description: 'Approve a time off request by ID',
				action: 'Approve a time off request',
			},
			{
				name: 'Reject',
				value: 'reject',
				description: 'Reject a time off request by ID with an optional reason',
				action: 'Reject a time off request',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Time Off Request ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['timeOffRequest'],
				operation: ['get', 'approve', 'reject'],
			},
		},
		description: 'The ID of the time off request to operate on',
	},
	{
		displayName: 'Reject Reason',
		name: 'rejectReason',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['timeOffRequest'],
				operation: ['reject'],
			},
		},
		description: 'Optional reason for rejecting the time off request',
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
				resource: ['timeOffRequest'],
				operation: ['getMany', 'count'],
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
