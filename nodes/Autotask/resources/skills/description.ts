import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a skill by ID',
		action: 'Get a skill',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple skills using field filters',
		action: 'Get multiple skills',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of skills',
		action: 'Count skills',
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
					'skill',
				],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Skill ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['skill'],
				operation: ['get'],
			},
		},
		description: 'The ID of the skill to retrieve',
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
				resource: ['skill'],
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

export const skillFields = baseFields;
