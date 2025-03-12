import type { INodePropertyOptions, INodeProperties } from 'n8n-workflow';

/**
 * Supported Autotask resources and their descriptions
 */
export const RESOURCE_DEFINITIONS: INodePropertyOptions[] = [
	{
		name: 'Billing Code',
		value: 'billingCode',
		description: 'Query Autotask Billing Codes',
	},
	{
		name: 'Company',
		value: 'company',
		description: 'Manage Autotask Companies',
	},
	{
		name: 'Company Note',
		value: 'companyNote',
		description: 'Manage Autotask Company Notes',
	},
	{
		name: 'Contact',
		value: 'contact',
		description: 'Manage Autotask Contacts',
	},
	{
		name: 'Product',
		value: 'product',
		description: 'Manage Autotask Products',
	},
	{
		name: 'Project',
		value: 'project',
		description: 'Manage Autotask Projects',
	},
	{
		name: 'Project Charge',
		value: 'projectCharge',
		description: 'Manage Autotask Project Charges',
	},
	{
		name: 'Project Note',
		value: 'projectNote',
		description: 'Manage Autotask Project Notes',
	},
	{
		name: 'Project Phase',
		value: 'phase',
		description: 'Manage Autotask Project Phases',
	},
	{
		name: 'Project Task',
		value: 'task',
		description: 'Manage Autotask Project Tasks',
	},
	{
		name: 'Resource',
		value: 'resource',
		description: 'Manage Autotask Resources',
	},
	{
		name: 'Search Filter',
		value: 'searchFilter',
		description: 'Build search filters for Autotask API queries',
	},
	{
		name: 'Ticket',
		value: 'ticket',
		description: 'Manage Autotask Tickets',
	},
	{
		name: 'Ticket History',
		value: 'TicketHistory',
		description: 'Query Autotask Ticket History',
	},
	{
		name: 'Ticket Note',
		value: 'ticketNote',
		description: 'Manage Autotask Ticket Notes',
	},
	{
		name: 'Time Entry',
		value: 'timeEntry',
		description: 'Manage Autotask Time Entries',
	},
];

export const RESOURCE_FIELD: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: RESOURCE_DEFINITIONS,
	default: 'company',
};
