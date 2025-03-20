import type { INodeProperties } from 'n8n-workflow';

export const contractServiceUnitFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractServiceUnit',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract service unit by ID',
				action: 'Get a contract service unit',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract service units',
				action: 'Get multiple contract service units',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract service units',
				action: 'Count contract service units',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Service Unit ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractServiceUnit'],
				operation: ['get'],
			},
		},
		description: 'The ID of the service unit to retrieve',
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
				resource: ['contractServiceUnit'],
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
