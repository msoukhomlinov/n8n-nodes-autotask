import type { INodeProperties } from 'n8n-workflow';

export const expenseItemAttachmentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['expenseItemAttachment'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Upload an attachment to an expense item',
				action: 'Upload an attachment',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get multiple expense item attachments',
				action: 'Get multiple attachments',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count expense item attachments matching criteria',
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
				description: 'Delete an expense item attachment',
				action: 'Delete an attachment',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Expense Item ID',
		name: 'expenseItemId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['expenseItemAttachment'],
				operation: ['create', 'download', 'delete'],
			},
		},
		description: 'The ID of the expense item to attach the file to',
	},
	{
		displayName: 'Attachment ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['expenseItemAttachment'],
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
				resource: ['expenseItemAttachment'],
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
				resource: ['expenseItemAttachment'],
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
				resource: ['expenseItemAttachment'],
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
				resource: ['expenseItemAttachment'],
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
