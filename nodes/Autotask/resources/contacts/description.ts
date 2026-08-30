import type { INodeProperties } from 'n8n-workflow';

export const contactFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: [
					'contact',
				],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contact',
				action: 'Create a contact',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contact by ID',
				action: 'Get a contact',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many contacts',
				action: 'Get many contacts',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contact',
				action: 'Update a contact',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count contacts',
				action: 'Count contacts',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contact',
				action: 'Delete a contact',
			},
			{
				name: 'Move to Company',
				value: 'moveToCompany',
				description: 'Copy a contact to a different company, optionally copy notes and group memberships, then deactivate the source',
				action: 'Move a contact to another company',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Contact ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['update', 'get', 'delete'],
			},
		},
		description: 'The ID of the contact to operate on',
	},
	{
		// v2.29.0 (Codex P1 on PR #148): the Autotask API exposes contact deletion
		// only via the company-scoped path (DELETE Companies/{companyID}/Contacts/{id});
		// DeleteOperation needs companyID to build that URL.
		displayName: 'Company ID',
		name: 'companyID',
		type: 'number',
		required: true,
		// x4 (Codex P2f): unset by default — a prefilled 0 satisfied required:true
		// without prompting, so ordinary contact deletions (contact not on the
		// root company) sent DELETE Companies/0/Contacts/{id} and failed. 0 is
		// still a VALID value (root-company contacts) — the user can enter it
		// explicitly. n8n never consults the property default at runtime, so this
		// is UI-only.
		default: undefined,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['delete'],
			},
		},
		description:
			"The company the contact belongs to — the API only exposes contact deletion via the company-scoped path (Companies/{companyID}/Contacts/{ID}). Root-company contacts use 0 — enter 0 explicitly only for those.",
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
				resource: ['contact'],
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
	// ─── Move to Company fields ─────────────────────────────────────────────
	{
		displayName: 'Source Contact ID',
		name: 'sourceContactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'The ID of the contact to move',
	},
	{
		displayName: 'Destination Company ID',
		name: 'destinationCompanyId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'The ID of the company to move the contact to',
	},
	{
		displayName: 'Dry Run',
		name: 'dryRun',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany', 'delete'],
			},
		},
		description: 'Whether to return a request preview instead of executing the operation (no changes are made to Autotask). For Move to Company, returns a migration plan; for Delete, returns the request that would be sent.',
	},
	{
		displayName: 'Destination Location ID',
		name: 'destinationCompanyLocationId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Location ID at the destination company. Leave blank to auto-map by location name, or enter a specific ID.',
	},
	{
		displayName: 'Skip If Duplicate Email Found',
		name: 'skipIfDuplicateEmailFound',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Whether to skip the move without error when a destination contact already exists with the same email address',
	},
	{
		displayName: 'Copy Contact Groups',
		name: 'copyContactGroups',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Whether to copy the contact\'s group memberships to the new contact',
	},
	{
		displayName: 'Copy Company Notes',
		name: 'copyCompanyNotes',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Whether to copy CompanyNotes linked to this contact (via contactID)',
	},
	{
		displayName: 'Copy Note Attachments',
		name: 'copyNoteAttachments',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
				copyCompanyNotes: [true],
			},
		},
		description: 'Whether to also copy attachments on those CompanyNotes (max 6MB per file)',
	},
	{
		displayName: 'Source Audit Note',
		name: 'sourceAuditNote',
		type: 'string',
		typeOptions: { rows: 3 },
		default: 'Contact {contactName} (ID: {sourceContactId}) was copied to Company ID: {destinationCompanyId} as new Contact ID: {newContactId} on {date}.\nNew contact: {newContactLink}\nThis contact has been deactivated.',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Note left on the source company. Placeholders: {contactName}, {sourceContactId}, {destinationCompanyId}, {newContactId}, {sourceContactLink}, {newContactLink}, {date}.',
	},
	{
		displayName: 'Destination Audit Note',
		name: 'destinationAuditNote',
		type: 'string',
		typeOptions: { rows: 3 },
		default: 'Contact {contactName} (ID: {newContactId}) was copied from Company ID: {sourceCompanyId} (original Contact ID: {sourceContactId}) on {date}.\nOriginal contact: {sourceContactLink}',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Note left on the destination company. Placeholders: {contactName}, {sourceContactId}, {sourceCompanyId}, {newContactId}, {sourceContactLink}, {newContactLink}, {date}.',
	},
	{
		displayName: 'Impersonation Resource ID',
		name: 'impersonationResourceId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Optional resource ID to impersonate. Created records (contact, notes, attachments) will be attributed to this resource. Leave blank to use the credential user.',
	},
	{
		displayName: 'Proceed Without Impersonation If Denied',
		name: 'proceedWithoutImpersonationIfDenied',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['moveToCompany'],
			},
		},
		description: 'Whether to proceed without impersonation when denied. Only applies when Impersonation Resource ID is set. When on, if the impersonated resource is active but Autotask denies the write due to permissions, the request is retried without impersonation and proceeds as the API user. Default: on.',
	},
];
