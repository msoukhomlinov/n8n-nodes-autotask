import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a survey by ID',
		action: 'Get a survey',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple surveys using field filters',
		action: 'Get multiple surveys',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of surveys',
		action: 'Count surveys',
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
					'survey',
				],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Survey ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['survey'],
				operation: ['get'],
			},
		},
		description: 'The ID of the survey to retrieve',
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
				resource: ['survey'],
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

export const surveyFields = baseFields;
