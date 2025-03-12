import type { INodeProperties } from 'n8n-workflow';
import { addOperationsToResource } from '../../helpers/resource-operations.helper';

const operationOptions = [
	{
		name: 'Get',
		value: 'get',
		description: 'Get a billing code by ID',
		action: 'Get a billing code',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple billing codes using field filters',
		action: 'Get multiple billing codes',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of billing codes',
		action: 'Count billing codes',
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
					'billingCode',
				],
			},
		},
		options: operationOptions,
		default: 'getMany',
	},
	{
		displayName: 'Billing Code ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['billingCode'],
				operation: ['get'],
			},
		},
		description: 'The ID of the billing code to retrieve',
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
				resource: ['billingCode'],
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

export const billingCodeFields = addOperationsToResource(baseFields, {
	resourceName: 'billingCode',
});
