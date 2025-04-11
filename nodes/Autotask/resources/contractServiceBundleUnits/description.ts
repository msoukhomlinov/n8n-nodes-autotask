import type { INodeProperties } from 'n8n-workflow';

export const contractServiceBundleUnitFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractServiceBundleUnit',
				],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contract service bundle unit by ID',
				action: 'Get a contract service bundle unit',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple contract service bundle units',
				action: 'Get multiple contract service bundle units',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count number of contract service bundle units',
				action: 'Count contract service bundle units',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Service Bundle Unit ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contractServiceBundleUnit'],
				operation: ['get'],
			},
		},
		description: 'The ID of the service bundle unit to retrieve',
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
				resource: ['contractServiceBundleUnit'],
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

// Export directly for picklist handling
export const entityFields = contractServiceBundleUnitFields;
