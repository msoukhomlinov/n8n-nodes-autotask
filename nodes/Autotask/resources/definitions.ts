import type { INodePropertyOptions, INodeProperties } from 'n8n-workflow';

/**
 * Supported Autotask resources and their descriptions
 */
export const RESOURCE_DEFINITIONS: INodePropertyOptions[] = [
	{
		name: 'API Threshold',
		value: 'apiThreshold',
		description: 'Check Autotask API usage limits and current threshold levels',
	},
	{
		name: 'Billing Code',
		value: 'billingCode',
		description: 'Query Billing Codes (Allocation Codes), which categorise billing items such as work types, materials, expenses, and services',
	},
	{
		name: 'Company',
		value: 'company',
		description: 'Manage Companies, which represent client organisations that serve as the central entity for contacts, tickets, projects, and other records',
	},
	{
		name: 'Company Alert',
		value: 'companyAlert',
		description: 'Manage Company Alerts, which display configurable messages on company pages about contract requirements, billing arrangements, or support needs',
	},
	{
		name: 'Company Location',
		value: 'companyLocation',
		description: 'Manage Company Locations, which represent business units associated with a company such as physical sites, divisions, or departments',
	},
	{
		name: 'Company Note',
		value: 'companyNote',
		description: 'Manage Company Notes, which store text information associated with companies, contacts or opportunities',
	},
	{
		name: 'Company Webhook',
		value: 'companyWebhook',
		description: 'Manage Autotask Company Webhooks',
	},
	{
		name: 'Configuration Item',
		value: 'configurationItems',
		description: 'Manage Assets (Configuration Items), which track hardware and software products associated with an organisation that are sold, installed, and managed',
	},
	{
		name: 'Configuration Item Billing Product Association',
		value: 'configurationItemBillingProductAssociation',
		description: 'Manage Product Associations, which map configuration items (assets) to contract billing rules',
	},
	{
		name: 'Configuration Item Category',
		value: 'configurationItemCategories',
		description: 'Manage Asset Categories, which classify configuration items into groups for organisation and reporting',
	},
	{
		name: 'Configuration Item Category UDF Association',
		value: 'configurationItemCategoryUdfAssociation',
		description: 'Manage Category Field Associations, which define which custom fields are visible for specific asset categories',
	},
	{
		name: 'Configuration Item DNS Record',
		value: 'configurationItemDnsRecord',
		description: 'Manage DNS Records, which store domain name system entries associated with configuration items for network and internet connectivity',
	},
	{
		name: 'Configuration Item Note',
		value: 'configurationItemNote',
		description: 'Manage Asset Notes, which store text information and comments associated with configuration items or devices',
	},
	{
		name: 'Configuration Item Related Item',
		value: 'configurationItemRelatedItem',
		description: 'Manage Asset Relationships, which connect configuration items in parent-child hierarchies for tracking dependencies and component structures',
	},
	{
		name: 'Configuration Item SSL Subject Alternative Name',
		value: 'configurationItemSslSubjectAlternativeName',
		description: 'Manage SSL Alternative Names, which store subject alternative name records associated with configuration items for secure website identification',
	},
	{
		name: 'Configuration Item Type',
		value: 'configurationItemTypes',
		description: 'Manage Asset Types, which classify configuration items into categories such as laptops, desktops, servers, or software applications',
	},
	{
		name: 'Configuration Item Webhook',
		value: 'configurationItemWebhook',
		description: 'Manage Autotask Configuration Item Webhooks',
	},
	{
		name: 'Contact',
		value: 'contact',
		description: 'Manage Contacts, which represent individuals associated with companies',
	},
	{
		name: 'Contact Webhook',
		value: 'contactWebhook',
		description: 'Manage Autotask Contact Webhooks',
	},
	{
		name: 'Contact Groups',
		value: 'contactGroups',
		description: 'Manage Contact Groups, which represent associations of contacts from one or more companies for bulk email and note creation',
	},
	{
		name: 'Contact Group Contacts',
		value: 'contactGroupContacts',
		description: 'Manage Contact Group Contacts, which associate Contacts with Contact Groups for bulk operations',
	},
	{
		name: 'Contract',
		value: 'contract',
		description: 'Manage Contracts, which specify billing arrangements with companies such as Time and Materials, Fixed Price, Block Hours, or Recurring Service',
	},
	{
		name: 'Contract Block',
		value: 'contractBlock',
		description: 'Manage Contract Blocks, which represent pre-purchased hours for Block Hours contracts that are consumed as billable work is performed',
	},
	{
		name: 'Contract Block Hour Factor',
		value: 'contractBlockHourFactor',
		description: 'Manage Block Hour Factors, which apply multipliers to role rates in Block Hours contracts to adjust how much pre-purchased time is consumed by different roles',
	},
	{
		name: 'Contract Billing Rule',
		value: 'contractBillingRule',
		description: 'Manage Contract Billing Rules, which generate charges that allow you to bill your customer by the end user or by the asset',
	},
	{
		name: 'Contract Charge',
		value: 'contractCharge',
		description: 'Manage Contract Charges, which represent billable or non-billable costs for products and materials associated with contracts',
	},
	{
		name: 'Contract Exclusion Billing Code',
		value: 'contractExclusionBillingCode',
		description: 'Manage Contract Exclusion Billing Codes, which represent Work Type billing codes that are excluded from a Contract',
	},
	{
		name: 'Contract Exclusion Role',
		value: 'contractExclusionRoles',
		description: 'Manage Contract Exclusion Roles, which represent billing Roles that have been excluded from a Contract',
	},
	{
		name: 'Contract Exclusion Sets',
		value: 'contractExclusionSets',
		description: 'Manage Contract Exclusion Sets, which describe reusable sets of roles and work types that are excluded from the contract the set is applied to',
	},
	{
		name: 'Contract Exclusion Set Excluded Role',
		value: 'contractExclusionSetExcludedRole',
		description: 'Manage Contract Exclusion Set Excluded Roles, which represent billing roles that are excluded from the contract the set is applied to',
	},
	{
		name: 'Contract Exclusion Set Excluded Work Type',
		value: 'contractExclusionSetExcludedWorkType',
		description: 'Manage Contract Exclusion Set Excluded Work Types, which represent billing Work Types (Allocation Codes) that are excluded from the contract the set is applied to',
	},
	{
		name: 'Contract Milestone',
		value: 'contractMilestone',
		description: 'Manage Contract Milestones, which define billing stages for Fixed Price Contracts based on completed deliverables or measured progress',
	},
	{
		name: 'Contract Note',
		value: 'contractNote',
		description: 'Manage Contract Notes, which store information, status updates, and communications associated with contracts',
	},
	{
		name: 'Contract Rate',
		value: 'contractRate',
		description: 'Manage Contract Rates, which override standard role rates for specific contracts to customise billing for Time and Materials, Fixed Price, and Retainer contracts',
	},
	{
		name: 'Contract Role Costs',
		value: 'contractRoleCosts',
		description: 'Manage Contract Role Costs, which define per hour cost for labor set at the contract level that override a resource\'s internal cost rate',
	},
	{
		name: 'Contract Retainer',
		value: 'contractRetainer',
		description: 'Manage Contract Retainers, which describe payment amounts applied to Retainer type contracts and set the time period covered by the purchase',
	},
	{
		name: 'Contract Service',
		value: 'contractService',
		description: 'Manage Contract Services, which associate predefined service offerings with recurring service contracts and specify customised pricing',
	},
	{
		name: 'Contract Service Adjustment',
		value: 'contractServiceAdjustment',
		description: 'Manage Contract Service Adjustments, which adjust the quantity of units of a service that are added to a Recurring Service type Contract',
	},
	{
		name: 'Contract Service Bundle Adjustment',
		value: 'contractServiceBundleAdjustment',
		description: 'Manage Contract Service Bundle Adjustments, which adjust the quantity of units of a Service Bundle that are added to a Recurring Service type Contract',
	},
	{
		name: 'Contract Service Bundle',
		value: 'contractServiceBundle',
		description: 'Manage Contract Service Bundles, which group multiple Services added to a Recurring Service type contract',
	},
	{
		name: 'Contract Service Bundle Unit',
		value: 'contractServiceBundleUnit',
		description: 'Query Service Bundle Units, which track the quantity of service bundles associated with recurring contracts for specific date ranges used in billing calculations',
	},
	{
		name: 'Contract Ticket Purchase',
		value: 'contractTicketPurchase',
		description: 'Manage Contract Ticket Purchases, which describe payment amounts applied to the purchase of (or pre-payment for) one or more Service Desk Tickets through a Per Ticket Contract',
	},
	{
		name: 'Contract Service Unit',
		value: 'contractServiceUnit',
		description: 'Query Service Units, which track the quantity of services associated with recurring contracts for specific date ranges used in billing calculations',
	},
	{
		name: 'Domain Registrar',
		value: 'DomainRegistrar',
		description: 'Manage Domain Registrars, which contain WHOIS details for Domain assets',
	},
	{
		name: 'Holiday',
		value: 'holiday',
		description: 'Manage Holidays, which specify non-working days included in Holiday Sets for time off tracking and scheduling calculations',
	},
	{
		name: 'Holiday Set',
		value: 'holidaySet',
		description: 'Manage Holiday Sets, which group holidays assigned to internal locations for tracking time off and managing work schedules',
	},
	{
		name: 'Invoice',
		value: 'invoice',
		description: 'Manage Invoices, which include billing items that have been approved and posted and are being billed to a customer',
	},
	{
		name: 'Notification History',
		value: 'notificationHistory',
		description: 'Query Notification History, which lists notifications sent from Autotask in the previous 30 days',
	},
	{
		name: 'Opportunity',
		value: 'opportunity',
		description: 'Manage Opportunities, which track potential sales with forecasted revenue, probability, due dates, and progress for sales forecasting',
	},
	{
		name: 'Product',
		value: 'product',
		description: 'Manage Products, which represent hardware, software, or material items that companies sell or support for customers',
	},
	{
		name: 'Product Vendor',
		value: 'productVendor',
		description: 'Manage Product Vendors, which are vendor companies associated with products in your inventory',
	},
	{
		name: 'Project',
		value: 'project',
		description: 'Manage Projects, which organise related tasks, events, and documents for a company into structured work with defined scope and deliverables',
	},
	{
		name: 'Project Charge',
		value: 'projectCharge',
		description: 'Manage Project Charges, which track billable or non-billable costs for products and materials associated with projects',
	},
	{
		name: 'Project Note',
		value: 'projectNote',
		description: 'Manage Project Notes, which store text information, updates, and communications associated with specific projects',
	},
	{
		name: 'Project Phase',
		value: 'phase',
		description: 'Manage Project Phases, which organise project tasks into logical groups or stages that can be nested in parent-child relationships',
	},
	{
		name: 'Project Task',
		value: 'task',
		description: 'Manage Project Tasks, which define work items assigned to resources within projects for scheduling, tracking, and completion',
	},
	{
		name: 'Resource',
		value: 'resource',
		description: 'Manage Resources, which represent users with Autotask accounts that have access to the system based on license type and security level',
	},
	{
		name: 'Resource Role',
		value: 'resourceRole',
		description: 'Query Resource Roles, which represent associations between Resources and Department/Role relationships, service desk queues, and service desk roles (note: only active roles are returned)',
	},
	{
		name: 'Role',
		value: 'role',
		description: 'Manage Roles, which are associated with departments and have standard billing rates used for resource time tracking and billing',
	},
	{
		name: 'Search Filter',
		value: 'searchFilter',
		description: 'Build JSON search filters query for Autotask Get Mnay Advanced operations',
	},
	{
		name: 'Service',
		value: 'service',
		description: 'Manage Services, which represent pre-defined units of work performed at regular intervals for a set price such as disk backups or virus checks',
	},
	{
		name: 'Service Call',
		value: 'serviceCall',
		description: 'Manage Service Calls, which schedule resources for specific time periods to perform work for companies with associated tasks and tickets',
	},
	{
		name: 'Skill',
		value: 'skill',
		description: 'Query Skills, which can be associated with Resources through the ResourceSkill entity to match resources to tickets based on their skill level',
	},
	{
		name: 'Survey',
		value: 'survey',
		description: 'Query Surveys, which collect structured feedback from clients about services, projects, and support experiences',
	},
	{
		name: 'Survey Results',
		value: 'surveyResults',
		description: 'Query Survey Results, which store customer feedback responses and ratings collected from completed surveys',
	},
	{
		name: 'Ticket',
		value: 'ticket',
		description: 'Manage Tickets, which define service requests that track client issues, support needs, and work to be performed across different modules',
	},
	{
		name: 'Ticket History',
		value: 'TicketHistory',
		description: 'Query Ticket History, which tracks changes to ticket fields and associated Service Level Agreements over time',
	},
	{
		name: 'Ticket Note',
		value: 'ticketNote',
		description: 'Manage Ticket Notes, which store information, updates, and communications associated with service desk tickets',
	},
	{
		name: 'Ticket Note Webhook',
		value: 'ticketNoteWebhook',
		description: 'Manage Autotask Ticket Note Webhooks',
	},
	{
		name: 'Ticket Webhook',
		value: 'ticketWebhook',
		description: 'Manage Autotask Ticket Webhooks',
	},
	{
		name: 'Time Entry',
		value: 'timeEntry',
		description: 'Manage Time Entries, which record resource work hours against tickets, tasks, or general activities such as meetings, travel, or training',
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
