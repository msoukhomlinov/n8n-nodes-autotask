import type { INodeProperties } from 'n8n-workflow';

export const resourceTimeOffApproverFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['resourceTimeOffApprover'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a resource time off approver record by ID',
				action: 'Get a resource time off approver',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple resource time off approver records using field filters',
				action: 'Get multiple resource time off approvers',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count resource time off approver records',
				action: 'Count resource time off approvers',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Resource Time Off Approver ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resourceTimeOffApprover'],
				operation: ['get'],
			},
		},
		description: 'The ID of the resource time off approver record',
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
				resource: ['resourceTimeOffApprover'],
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
