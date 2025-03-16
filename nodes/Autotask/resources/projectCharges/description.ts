import type { INodeProperties } from 'n8n-workflow';

export const projectChargeFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'projectCharge',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project charge',
				action: 'Create a project charge',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project charge',
				action: 'Update a project charge',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a project charge',
				action: 'Delete a project charge',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project charge by ID',
				action: 'Get a project charge',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple project charges',
				action: 'Get multiple project charges',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of project charges',
				action: 'Count project charges',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Charge ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['projectCharge'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the charge to operate on',
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
				resource: ['projectCharge'],
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
