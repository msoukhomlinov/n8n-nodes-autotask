import type { INodeProperties } from 'n8n-workflow';

export const classificationIconFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'classificationIcon',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a classification icon by ID',
				action: 'Get a classification icon',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple classification icons',
				action: 'Get multiple classification icons',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of classification icons',
				action: 'Count classification icons',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Classification Icon ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['classificationIcon'],
				operation: ['get'],
			},
		},
		description: 'The ID of the classification icon to retrieve',
	},
	{
		displayName: 'Fields',
		name: 'fieldsToMap',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {},
		required: true,
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
		displayOptions: {
			show: {
				resource: ['classificationIcon'],
				operation: ['getMany', 'count'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
