import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Update',
		value: 'update',
		description: 'Update a purchase approval',
		action: 'Update a purchase approval',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a purchase approval by ID',
		action: 'Get a purchase approval',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple purchase approvals',
		action: 'Get multiple purchase approvals',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of purchase approvals',
		action: 'Count purchase approvals',
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
					'purchaseApprovals',
				],
			},
		},
		options: operationOptions,
		default: 'get',
	},
	{
		displayName: 'Purchase Approval ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['purchaseApprovals'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the purchase approval to operate on',
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
				resource: ['purchaseApprovals'],
				operation: ['update', 'getMany', 'count'],
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

export const purchaseApprovalsFields = baseFields;
