import type { INodeProperties } from 'n8n-workflow';
import { addOperationsToResource } from '../../helpers/resource-operations.helper';

const operationOptions = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a company',
		action: 'Create a company',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a company',
		action: 'Update a company',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a company by ID',
		action: 'Get a company',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Get multiple companies using field filters',
		action: 'Get multiple companies',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count number of companies',
		action: 'Count companies',
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
					'company',
				],
			},
		},
		options: operationOptions,
		default: 'create',
	},
	{
		displayName: 'Company ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['company'],
				operation: ['update', 'get'],
			},
		},
		description: 'The ID of the company to operate on',
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
				resource: ['company'],
				operation: ['create', 'update', 'getMany', 'count'],
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

export const companyFields = addOperationsToResource(baseFields, {
	resourceName: 'company',
});
