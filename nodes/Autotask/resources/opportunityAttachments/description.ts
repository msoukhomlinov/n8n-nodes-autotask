import type { INodeProperties } from 'n8n-workflow';

export const opportunityAttachmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['opportunityAttachment'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Upload an attachment to an opportunity',
				action: 'Upload an attachment',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple opportunity attachments',
				action: 'Get multiple attachments',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count opportunity attachments matching criteria',
				action: 'Count attachments',
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
				description: 'Delete an opportunity attachment',
				action: 'Delete an attachment',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Opportunity ID',
		name: 'opportunityId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunityAttachment'],
				operation: ['create', 'download', 'delete'],
			},
		},
		description: 'The ID of the opportunity to attach the file to',
	},
	{
		displayName: 'Attachment ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunityAttachment'],
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
				resource: ['opportunityAttachment'],
				operation: ['create', 'download'],
			},
		},
		description: 'Name of the binary property to read from (create) or write to (download)',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['opportunityAttachment'],
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
				resource: ['opportunityAttachment'],
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
				resource: ['opportunityAttachment'],
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
