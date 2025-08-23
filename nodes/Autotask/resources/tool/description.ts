import type { INodeProperties } from 'n8n-workflow';
import { addAgentFriendlyOptions } from '../../operations/common/json-parameters';

export const toolFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
		options: [
			{
				name: 'Execute',
				value: 'execute',
				description: 'Execute any Autotask operation dynamically',
				action: 'Execute autotask operation',
			},
		],
		default: 'execute',
	},
	{
		displayName: 'Target Resource Name or ID',
		name: 'targetResource',
		type: 'string',
		required: true,
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getQueryableEntities',
		},
		default: '',
		description:
			'Enter the target resource name or ID. Choose from the list or specify it using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Resource Operation Name or ID',
		name: 'resourceOperation',
		type: 'string',
		required: true,
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getResourceOperations',
			loadOptionsDependsOn: ['targetResource'],
		},
		default: '',
		description:
			'Enter the operation name or ID for the selected resource. Choose from the list or specify it using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Entity ID',
		name: 'entityId',
		type: 'string',
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
				resourceOperation: ['get', 'update', 'delete'],
			},
		},
		default: '',
		description: 'The ID of the entity (required for get, update, delete operations)',
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
				resourceOperation: ['create', 'update'],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['targetResource', 'resourceOperation'],
			resourceMapper: {
				resourceMapperMethod: 'getToolFields',
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
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
				resourceOperation: ['getMany', 'count'],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['targetResource', 'resourceOperation'],
			resourceMapper: {
				resourceMapperMethod: 'getToolFields',
				mode: 'add',
				fieldWords: {
					singular: 'filter',
					plural: 'filters',
				},
				addAllFields: false,
				multiKeyMatch: true,
				supportAutoMap: true,
			},
		},
	},
];

// Add AI Agent-friendly options to the tool fields
// Tool resource should include all agent-friendly options for AI Agent compatibility
export const toolFieldsWithAgentOptions = addAgentFriendlyOptions(toolFields, 'tool', {
	includeBodyJson: true,
	includeSelectColumnsJson: true,
	includeOutputMode: true,
	includeDryRun: true,
});
