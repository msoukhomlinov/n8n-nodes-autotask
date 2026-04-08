import type { INodeProperties } from 'n8n-workflow';

export const resourceSkillFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['resourceSkill'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a resource skill assignment by ID',
				action: 'Get a resource skill',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple resource skill assignments using field filters',
				action: 'Get multiple resource skills',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count resource skill assignments',
				action: 'Count resource skills',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a resource skill assignment (e.g. skill level)',
				action: 'Update a resource skill',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Resource Skill ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resourceSkill'],
				operation: ['get', 'update'],
			},
		},
		description: 'The ID of the resource skill record',
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
				resource: ['resourceSkill'],
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
