import type { INodeProperties } from 'n8n-workflow';

export const contractServiceAdjustmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractServiceAdjustment',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract service adjustment',
				action: 'Create a contract service adjustment',
			},
		],
		default: 'create',
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
				resource: ['contractServiceAdjustment'],
				operation: ['create'],
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

// Export baseFields for picklist support
export const entityFields = contractServiceAdjustmentFields;
