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
		name: 'Get Many (Advanced)',
		value: 'getManyAdvanced',
		description: 'Get multiple survey results using advanced filters',
		action: 'Get multiple survey results (advanced)',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of survey results',
		action: 'Count survey results',
	},
	{
		name: 'Get Entity Info',
		value: 'getEntityInfo',
		description: 'Get entity information including fields',
		action: 'Get entity information',
	},
	{
		name: 'Get Field Info',
		value: 'getFieldInfo',
		description: 'Get field information',
		action: 'Get field information',
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

// Add advanced options for the getManyAdvanced operation
const advancedOptions: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['surveyResults'],
				operation: ['getManyAdvanced'],
			},
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Max Records',
		name: 'maxRecords',
		type: 'number',
		default: 10,
		displayOptions: {
			show: {
				resource: ['surveyResults'],
				operation: ['getManyAdvanced'],
				returnAll: [false],
			},
		},
		description: 'Max number of records to return',
	},
];

export const surveyResultsFields = [...baseFields, ...advancedOptions];
