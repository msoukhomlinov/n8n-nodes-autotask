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
		name: 'Company Alert',
		value: 'companyAlert',
		description: 'Manage Autotask Company Alerts',
	},
	{
		name: 'Company Location',
		value: 'companyLocation',
		description: 'Manage Autotask Company Locations',
	},
	{
		name: 'Company Note',
		value: 'companyNote',
		description: 'Manage Autotask Company Notes',
	},
	{
		name: 'Company Webhook',
		value: 'companyWebhook',
		description: 'Manage Autotask Company Webhooks',
	},
	{
		name: 'Configuration Item',
		value: 'configurationItems',
		description: 'Manage Autotask Configuration Items (assets or devices that are associated with an organization)',
	},
	{
		name: 'Configuration Item Billing Product Association',
		value: 'configurationItemBillingProductAssociation',
		description: 'Manage Autotask Configuration Item Billing Product Associations. This entity describes the mapping of the Asset (Configuration Item) to the contract billing rule.',
	},
	{
		name: 'Configuration Item Category',
		value: 'configurationItemCategories',
		description: 'Manage Autotask Configuration Item Categories. This entity describes a category assigned to a Configuration Item (asset) in Autotask.',
	},
	{
		name: 'Configuration Item Category UDF Association',
		value: 'configurationItemCategoryUdfAssociation',
		description: 'Manage Autotask Configuration Item Category UDF Associations. This entity represents the relationship between an asset category and a specific UDF.',
	},
	{
		name: 'Configuration Item DNS Record',
		value: 'configurationItemDnsRecord',
		description: 'Manage Autotask Configuration Item DNS Records. This entity describes DNS records associated with Configuration Items in Autotask.',
	},
	{
		name: 'Configuration Item Note',
		value: 'configurationItemNote',
		description: 'Manage Autotask Configuration Item Notes. This entity describes notes created by an Autotask user and associated with an Asset entity.',
	},
	{
		name: 'Configuration Item Related Item',
		value: 'configurationItemRelatedItem',
		description: 'Manage Autotask Configuration Item Related Items. This entity enables you to view, add, and remove related child or parent Assets in Autotask.',
	},
	{
		name: 'Configuration Item SSL Subject Alternative Name',
		value: 'configurationItemSslSubjectAlternativeName',
		description: 'Manage Autotask Configuration Item SSL Subject Alternative Names. This entity contains SSL Subject Alternative Name (SAN) records associated with Configuration Items in Autotask.',
	},
	{
		name: 'Configuration Item Type',
		value: 'configurationItemTypes',
		description: 'Manage Autotask Configuration Item Types. This entity describes a type, for example, laptop or desktop, assigned to an Asset in Autotask (categories or classifications for configuration items).',
	},
	{
		name: 'Configuration Item Webhook',
		value: 'configurationItemWebhook',
		description: 'Manage Autotask Configuration Item Webhooks',
	},
	{
		name: 'Contact',
		value: 'contact',
		description: 'Manage Autotask Contacts. The Contacts entity describes an individual associated with a Company.',
	},
	{
		name: 'Contact Webhook',
		value: 'contactWebhook',
		description: 'Manage Autotask Contact Webhooks',
	},
	{
		name: 'Contract',
		value: 'contract',
		description: 'Manage Autotask Contracts',
	},
	{
		name: 'Contract Block',
		value: 'contractBlock',
		description: 'Manage Autotask Contract Blocks. The Contract Block represents a block of hours purchased for a Block Hours type Contract. With a Block Hours Contract, the customer pre-pays for a block of hours and then the pre-paid hours are reduced as billable work is performed.',
	},
	{
		name: 'Contract Block Hour Factor',
		value: 'contractBlockHourFactor',
		description: 'Manage Autotask Block Hour Factors. These apply multipliers to specific role rates in Block Hours Contracts, allowing different roles to consume contract hours at different rates.',
	},
	{
		name: 'Contract Charge',
		value: 'contractCharge',
		description: 'Manage billing items (costs) associated with Autotask Contracts. Contract Charges represent billable or non-billable products/materials that appear in Approve and Post.',
	},
	{
		name: 'Contract Milestone',
		value: 'contractMilestone',
		description: 'Manage Autotask Contract Milestones. This entity describes milestones associated with Autotask Contracts, allowing for tracking key deliverables and payment stages.',
	},
	{
		name: 'Contract Note',
		value: 'contractNote',
		description: 'Manage Autotask Contract Notes. This entity describes a note associated with an Autotask Contract, allowing for documentation of important contract information and communication.',
	},
	{
		name: 'Contract Rate',
		value: 'contractRate',
		description: 'Manage Autotask Contract Rates. These contract-specific billing rates override standard role rates for labor tracked against Time and Materials, Fixed Price, and Retainer contracts.',
	},
	{
		name: 'Contract Service',
		value: 'contractService',
		description: 'Manage Autotask Contract Services. This entity describes an Autotask Service that has been added to a Recurring Service type contract.',
	},
	{
		name: 'Contract Service Unit',
		value: 'contractServiceUnit',
		description: 'Query Autotask Contract Service Units. This read-only entity provides information about service units associated with Autotask Contract Services.',
	},
	{
		name: 'Holiday',
		value: 'holiday',
		description: 'Manage Autotask Holidays within Holiday Sets',
	},
	{
		name: 'Holiday Set',
		value: 'holidaySet',
		description: 'Manage Autotask Holiday Sets',
	},
	{
		name: 'Opportunity',
		value: 'opportunity',
		description: 'Manage Autotask Opportunities',
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
		name: 'Service',
		value: 'service',
		description: 'Manage Autotask Services. These represent pre-defined units of work performed for a set price that are billed at regular intervals.',
	},
	{
		name: 'Service Call',
		value: 'serviceCall',
		description: 'Manage Autotask Service Calls',
	},
	{
		name: 'Survey',
		value: 'survey',
		description: 'Query Autotask Surveys. This entity describes general information for a survey generated by Autotask.',
	},
	{
		name: 'Survey Results',
		value: 'surveyResults',
		description: 'Query Autotask Survey Results. This entity describes information and results for surveys generated by Autotask.',
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
		name: 'Ticket Note Webhook',
		value: 'ticketNoteWebhook',
		description: 'Manage Autotask Ticket Note Webhooks',
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
