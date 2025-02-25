import type { INodeProperties } from 'n8n-workflow';

export const projectPhaseFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'phase',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project phase',
				action: 'Create a project phase',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a project phase',
				action: 'Update a project phase',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project phase by ID',
				action: 'Get a project phase',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple project phases',
				action: 'Get multiple project phases',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of project phases',
				action: 'Count project phases',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Project ID',
		name: 'projectID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['phase'],
				operation: ['get'],
			},
		},
		description: 'The ID of the project this phase belongs to',
	},
	{
		displayName: 'Phase ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['phase'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the phase to update',
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
				resource: ['phase'],
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
