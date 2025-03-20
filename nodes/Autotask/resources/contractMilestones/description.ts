import type { INodeProperties } from 'n8n-workflow';

export const contractMilestoneFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractMilestone',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract milestone',
				action: 'Create a contract milestone',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contract milestone',
				action: 'Update a contract milestone',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract milestone by ID',
				action: 'Get a contract milestone',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract milestones',
				action: 'Get multiple contract milestones',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract milestones',
				action: 'Count contract milestones',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Milestone ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractMilestone'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the milestone to operate on',
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
				resource: ['contractMilestone'],
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