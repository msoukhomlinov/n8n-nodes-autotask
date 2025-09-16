import type { INodeProperties } from 'n8n-workflow';

export const ticketChecklistLibraryFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'ticketChecklistLibrary',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add all items from a checklist library to a ticket',
				action: 'Add checklist library to ticket',
			},
		],
		default: 'create',
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
				resource: ['ticketChecklistLibrary'],
				operation: ['create'],
			},
		},
		description: 'Map the fields to be used in the operation',
	},
];
