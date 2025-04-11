import type { INodeProperties } from 'n8n-workflow';

export const contractServiceBundleAdjustmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contractServiceBundleAdjustment',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contract service bundle adjustment',
				action: 'Create a contract service bundle adjustment',
			},
			{
				name: 'Get Entity Info',
				value: 'getEntityInfo',
				description: 'Get basic entity information',
				action: 'Get entity info',
			},
			{
				name: 'Get Field Info',
				value: 'getFieldInfo',
				description: 'Get information about entity fields',
				action: 'Get field info',
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
				resource: ['contractServiceBundleAdjustment'],
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
export const entityFields = contractServiceBundleAdjustmentFields;
