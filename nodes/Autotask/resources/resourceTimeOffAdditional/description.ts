import type { INodeProperties } from 'n8n-workflow';

export const resourceTimeOffAdditionalFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['resourceTimeOffAdditional'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get the time-off additional quotas for a resource',
				action: 'Get resource time off additional',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the time-off additional quotas for a resource',
				action: 'Update resource time off additional',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Resource ID',
		name: 'resourceID',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['resourceTimeOffAdditional'],
				operation: ['get', 'update'],
			},
		},
		description: 'The numeric ID of the resource',
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
				resource: ['resourceTimeOffAdditional'],
				operation: ['update'],
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
