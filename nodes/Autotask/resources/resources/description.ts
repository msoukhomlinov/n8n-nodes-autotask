import type { INodeProperties } from 'n8n-workflow';

export const resourceFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'resource',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a resource by ID',
				action: 'Get a resource',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple resources',
				action: 'Get multiple resources',
			},
			{
				name: 'Who Am I',
				value: 'whoAmI',
				description: 'Retrieve the resource details of the API user specified in the node credentials',
				action: 'Get API user resource details',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a resource',
				action: 'Update a resource',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of resources',
				action: 'Count resources',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Resource ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resource'],
				operation: ['update', 'get'],
			},
		},

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
				resource: ['resource'],
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
