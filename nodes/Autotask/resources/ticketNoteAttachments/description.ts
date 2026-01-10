import type { INodeProperties } from 'n8n-workflow';

export const ticketNoteAttachmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Upload an attachment to a ticket note',
				action: 'Upload an attachment',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple ticket note attachments',
				action: 'Get multiple attachments',
			},
			{
				name: 'Get Many Advanced',
				value: 'getManyAdvanced',
				description: 'Get multiple ticket note attachments with advanced filtering',
				action: 'Get multiple attachments with advanced filtering',
			},
			{
				name: 'Download',
				value: 'download',
				description: 'Download an attachment as binary data',
				action: 'Download an attachment',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a ticket note attachment',
				action: 'Delete an attachment',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count ticket note attachments',
				action: 'Count attachments',
			},
			{
				name: 'Get Entity Info',
				value: 'getEntityInfo',
				description: 'Get metadata about the Ticket Note Attachment entity',
				action: 'Get entity info',
			},
			{
				name: 'Get Field Info',
				value: 'getFieldInfo',
				description: 'Get field definitions for Ticket Note Attachment',
				action: 'Get field info',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Ticket Note ID',
		name: 'ticketNoteId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
				operation: ['create', 'download', 'delete'],
			},
		},
		description: 'The ID of the ticket note to attach the file to',
	},
	{
		displayName: 'Attachment ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
				operation: ['download', 'delete'],
			},
		},
		description: 'The ID of the attachment to download or delete',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
				operation: ['create', 'download'],
			},
		},
		description: 'Name of the binary property to store the file in the output',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
				operation: ['create'],
			},
		},
		description: 'Title of the attachment',
	},
	{
		displayName: 'Publish',
		name: 'publish',
		type: 'options',
		default: 1,
		displayOptions: {
			show: {
				resource: ['ticketNoteAttachment'],
				operation: ['create'],
			},
		},
		options: [
			{
				name: 'All',
				value: 1,
				description: 'Visible to all users',
			},
			{
				name: 'Internal',
				value: 2,
				description: 'Visible to internal users only',
			},
		],
		description: 'Publish setting for the attachment',
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
				resource: ['ticketNoteAttachment'],
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
