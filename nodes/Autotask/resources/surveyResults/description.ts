import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a survey result by ID',
		action: 'Get a survey result',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple survey results using field filters',
		action: 'Get multiple survey results',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of survey results',
		action: 'Count survey results',
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
					'surveyResults',
				],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Survey Result ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['surveyResults'],
				operation: ['get'],
			},
		},
		description: 'The ID of the survey result to retrieve',
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
				resource: ['surveyResults'],
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

export const surveyResultsFields = baseFields;
