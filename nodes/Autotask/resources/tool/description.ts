import type { INodeProperties } from 'n8n-workflow';

// AI-First Tool Resource Design
// Optimized entirely for AI Node usage with simple string/JSON parameters
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
		displayName: 'Target Operation',
		name: 'targetOperation',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'ticket.create',
		description: 'Resource and operation in format "resource.operation" (e.g., ticket.create, company.getMany, contact.update)',
		hint: 'Use aiHelper.listCapabilities() to see all available resource.operation combinations.\n\nExamples:\n• ticket.create - Create a new ticket\n• company.getMany - Get multiple companies\n• contact.update - Update a contact\n• timeEntry.delete - Delete a time entry',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Entity ID',
		name: 'entityId',
		type: 'string',
		default: '',
		placeholder: '12345',
		description: 'Entity ID for get, update, and delete operations',
		hint: 'Required for operations that target a specific entity by ID (get, update, delete). Not needed for create or getMany operations.',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Request Data (JSON)',
		name: 'requestData',
		type: 'json',
		default: '{}',
		placeholder: '{\n  "title": "New Ticket",\n  "description": "Created via AI",\n  "priority": "High",\n  "companyID": 123\n}',
		description: 'Data for the operation: field values for create/update operations, filters for read operations',
		hint: 'Use aiHelper.describeResource(resource, "write") for create/update field requirements.\nUse aiHelper.describeResource(resource, "read") for available filter fields.\n\nExamples:\n• Create: {"title": "New Ticket", "priority": "High"}\n• Update: {"title": "Updated Title", "status": "Complete"}\n• Filters: {"filter": [{"field": "status", "op": "eq", "value": "Open"}]}',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Select Columns (JSON)',
		name: 'selectColumns',
		type: 'json',
		default: '[]',
		placeholder: '["ID", "title", "status", "priority", "companyID"]',
		description: 'Array of field names to return for read operations. Empty array returns all fields.',
		hint: 'Specify which fields to include in the response. Use aiHelper.describeResource(resource, "read") to see available fields.\n\nExamples:\n• ["ID", "title", "status"] - Return only these fields\n• [] - Return all fields',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},

	{
		displayName: 'Dry Run',
		name: 'dryRun',
		type: 'boolean',
		default: false,
		description: 'Whether to return a preview of the operation without executing it',
		hint: 'When enabled, validates the request and shows what would be sent to the API without making actual changes. Useful for testing and validation.',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Allow Write Operations',
		name: 'allowWriteOperations',
		type: 'boolean',
		default: false,
		description: 'Whether to allow write operations (create, update, delete). Disabled by default for safety.',
		hint: 'Enable this to allow create, update, and delete operations. When disabled, only read operations (get, getMany) are permitted.',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Allow Dry Run for Writes',
		name: 'allowDryRunForWrites',
		type: 'boolean',
		default: true,
		description: 'Whether to allow dry-run previews for write operations when writes are disabled',
		hint: 'When write operations are disabled, this still allows dry-run validation and preview without actual execution.',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
	{
		displayName: 'Allowed Resources (JSON)',
		name: 'allowedResources',
		type: 'json',
		default: '[]',
		placeholder: '["ticket", "company", "contact"]',
		description: 'Array of allowed resource names. Empty array means all resources are allowed.',
		hint: 'Restrict operations to specific resources for security. Leave empty to allow all resources.\n\nExample: ["ticket", "company", "contact"] - Only allow operations on these three resources.',
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
	},
];

// Export as final fields - no complex UI additions needed for AI-first design
export const toolFieldsWithAgentOptions = toolFields;
