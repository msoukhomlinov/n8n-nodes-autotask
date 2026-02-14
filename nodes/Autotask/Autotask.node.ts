import {
	NodeConnectionType,
	type ResourceMapperFields,
	NodeOperationError,
} from 'n8n-workflow';
import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	IGetNodeParameterOptions,
} from 'n8n-workflow';
import { executeProjectTaskOperation } from './resources/projectTasks/execute';
import { executeProjectOperation } from './resources/projects/execute';
import { executeCompanyOperation } from './resources/companies/execute';
import { executeCompanyAlertOperation } from './resources/companyAlerts/execute';
import { executeContactOperation } from './resources/contacts/execute';
import { executeContactWebhookOperation } from './resources/contactWebhooks/execute';
import { executeContactGroupsOperation } from './resources/contactGroups/execute';
import { executeCompanyLocationOperation } from './resources/companyLocations/execute';
import { executeResourceOperation } from './resources/resources/execute';
import { executeResourceRoleOperation } from './resources/resourceRoles/execute';
import { executeRoleOperation } from './resources/roles/execute';
import { executeCompanyNoteOperation } from './resources/companyNotes/execute';
import { executeCompanySiteConfigurationOperation } from './resources/companySiteConfigurations/execute';
import { executeCompanyWebhookOperation } from './resources/companyWebhooks/execute';
import { executeConfigurationItemWebhookOperation } from './resources/configurationItemWebhooks/execute';
import { executeTicketNoteWebhookOperation } from './resources/ticketNoteWebhooks/execute';
import { executeProjectNoteOperation } from './resources/projectNotes/execute';
import { executeProjectPhaseOperation } from './resources/projectPhases/execute';
import { executeProjectChargeOperation } from './resources/projectCharges/execute';
import { executeProductOperation } from './resources/products/execute';
import { executeProductVendorOperation } from './resources/productVendors/execute';
import { executeTicketOperation } from './resources/tickets/execute';
import { executeTicketChangeRequestApprovalOperation } from './resources/ticketChangeRequestApprovals/execute';
import { executeTicketChargeOperation } from './resources/ticketCharges/execute';
import { executeTicketChecklistItemOperation } from './resources/ticketChecklistItems/execute';
import { executeTicketChecklistLibraryOperation } from './resources/ticketChecklistLibraries/execute';
import { executeTicketNoteOperation } from './resources/ticketNotes/execute';
import { executeTicketNoteAttachmentOperation } from './resources/ticketNoteAttachments/execute';
import { executeTicketAttachmentOperation } from './resources/ticketAttachments/execute';
import { executeTicketCategoryOperation } from './resources/ticketCategories/execute';
import { executeTicketCategoryFieldDefaultOperation } from './resources/ticketCategoryFieldDefaults/execute';
import { executeTicketSecondaryResourceOperation } from './resources/ticketSecondaryResources/execute';
import { executeTicketHistoryOperation } from './resources/ticketHistories/execute';
import { executeTimeEntryOperation } from './resources/timeEntries/execute';
import { executeTimeEntryAttachmentOperation } from './resources/timeEntryAttachments/execute';
import { executeBillingCodeOperation } from './resources/billingCodes/execute';
import { executeBillingItemsOperation } from './resources/billingItems/execute';
import { executeChecklistLibraryOperation } from './resources/checklistLibraries/execute';
import { executeChecklistLibraryChecklistItemOperation } from './resources/checklistLibraryChecklistItems/execute';
import { executeClassificationIconOperation } from './resources/classificationIcons/execute';
import { executeHolidaySetOperation } from './resources/holidaySets/execute';
import { executeHolidayOperation } from './resources/holidays/execute';
import { executeInvoiceOperation } from './resources/invoices/execute';
import { executeNotificationHistoryOperation } from './resources/notificationHistory/execute';
import { executeServiceCallOperation } from './resources/serviceCalls/execute';
import { executeServiceCallTicketOperation } from './resources/serviceCallTickets/execute';
import { executeServiceCallTaskOperation } from './resources/serviceCallTasks/execute';
import { executeServiceCallTaskResourceOperation } from './resources/serviceCallTaskResources/execute';
import { executeServiceLevelAgreementResultOperation } from './resources/serviceLevelAgreementResults/execute';
import { executeServiceOperation } from './resources/services/execute';
import { executeSubscriptionOperation } from './resources/subscriptions/execute';
import { executeSubscriptionPeriodsOperation } from './resources/subscriptionPeriods/execute';
import { executeTagOperation } from './resources/tags/execute';
import { executeTagAliasOperation } from './resources/tagAliases/execute';
import { executeTagGroupOperation } from './resources/tagGroups/execute';
import { executeContractOperation } from './resources/contracts/execute';
import { executeContractChargeOperation } from './resources/contractCharges/execute';
import { executeContractNoteOperation } from './resources/contractNotes/execute';
import { executeContractServiceOperation } from './resources/contractServices/execute';
import { executeContractServiceAdjustmentOperation } from './resources/contractServiceAdjustments/execute';
import { executeContractServiceBundleAdjustmentOperation } from './resources/contractServiceBundleAdjustments/execute';
import { executeContractServiceBundleOperation } from './resources/contractServiceBundles/execute';
import { executeContractServiceBundleUnitOperation } from './resources/contractServiceBundleUnits/execute';
import { executeContractMilestoneOperation } from './resources/contractMilestones/execute';
import { executeContractServiceUnitOperation } from './resources/contractServiceUnits/execute';
import { executeContractBlockOperation } from './resources/contractBlocks/execute';
import { executeContractBlockHourFactorOperation } from './resources/contractBlockHourFactors/execute';
import { executeContractRateOperation } from './resources/contractRates/execute';
import { executeContractExclusionBillingCodeOperation } from './resources/contractExclusionBillingCodes/execute';
import { executeContractExclusionRoleOperation } from './resources/contractExclusionRoles/execute';
import { executeContractExclusionSetsOperation } from './resources/contractExclusionSets/execute';
import { executeContractExclusionSetExcludedRolesOperation } from './resources/contractExclusionSetExcludedRoles/execute';
import { executeContractExclusionSetExcludedWorkTypesOperation } from './resources/contractExclusionSetExcludedWorkTypes/execute';
import { executeOpportunityOperation } from './resources/opportunities/execute';
import { searchFilterDescription, searchFilterOperations, build as executeSearchFilterOperation, dynamicBuild as executeDynamicSearchFilterOperation } from './resources/searchFilter';
import { getResourceMapperFields } from './helpers/resourceMapper';
import { getEntityMetadata } from './constants/entities';
import { RESOURCE_DEFINITIONS } from './resources/definitions';
import { initializeRateTracker } from './helpers/http/initRateTracker';
import { projectTaskFields } from './resources/projectTasks/description';
import { projectFields } from './resources/projects/description';
import { companyFields } from './resources/companies/description';
import { companyAlertFields } from './resources/companyAlerts/description';
import { contactFields } from './resources/contacts/description';
import { companyLocationFields } from './resources/companyLocations/description';
import { resourceFields } from './resources/resources/description';
import { resourceRoleFields } from './resources/resourceRoles/description';
import { roleFields } from './resources/roles/description';
import { companyNoteFields } from './resources/companyNotes/description';
import { companySiteConfigurationFields } from './resources/companySiteConfigurations/description';
import { projectNoteFields } from './resources/projectNotes/description';
import { projectPhaseFields } from './resources/projectPhases/description';
import { projectChargeFields } from './resources/projectCharges/description';
import { productFields } from './resources/products/description';
import { productVendorFields } from './resources/productVendors/description';
import { ticketFields } from './resources/tickets/description';
import { ticketChangeRequestApprovalFields } from './resources/ticketChangeRequestApprovals/description';
import { ticketChargeFields } from './resources/ticketCharges/description';
import { ticketChecklistItemFields } from './resources/ticketChecklistItems/description';
import { ticketChecklistLibraryFields } from './resources/ticketChecklistLibraries/description';
import { ticketCategoryFields } from './resources/ticketCategories/description';
import { ticketCategoryFieldDefaultFields } from './resources/ticketCategoryFieldDefaults/description';
import { ticketSecondaryResourceFields } from './resources/ticketSecondaryResources/description';
import { ticketHistoryFields } from './resources/ticketHistories/description';
import { ticketNoteFields } from './resources/ticketNotes/description';
import { ticketNoteAttachmentFields } from './resources/ticketNoteAttachments/description';
import { ticketAttachmentFields } from './resources/ticketAttachments/description';
import { timeEntryFields } from './resources/timeEntries/description';
import { timeEntryAttachmentFields } from './resources/timeEntryAttachments/description';
import { billingCodeFields } from './resources/billingCodes/description';
import { billingItemsFields } from './resources/billingItems/description';
import { checklistLibraryFields } from './resources/checklistLibraries/description';
import { checklistLibraryChecklistItemFields } from './resources/checklistLibraryChecklistItems/description';
import { classificationIconFields } from './resources/classificationIcons/description';
import { holidaySetFields } from './resources/holidaySets/description';
import { holidayFields } from './resources/holidays/description';
import { invoiceFields } from './resources/invoices/description';
import { notificationHistoryFields } from './resources/notificationHistory/description';
import { serviceCallFields } from './resources/serviceCalls/description';
import { serviceCallTicketFields } from './resources/serviceCallTickets/description';
import { serviceCallTaskFields } from './resources/serviceCallTasks/description';
import { serviceCallTaskResourceFields } from './resources/serviceCallTaskResources/description';
import { serviceLevelAgreementResultFields } from './resources/serviceLevelAgreementResults/description';
import { serviceFields } from './resources/services/description';
import { subscriptionFields } from './resources/subscriptions/description';
import { subscriptionPeriodsFields } from './resources/subscriptionPeriods/description';
import { tagFields } from './resources/tags/description';
import { tagAliasFields } from './resources/tagAliases/description';
import { tagGroupFields } from './resources/tagGroups/description';
import { contractFields } from './resources/contracts/description';
import { contractChargeFields } from './resources/contractCharges/description';
import { contractNoteFields } from './resources/contractNotes/description';
import { contractServiceFields } from './resources/contractServices/description';
import { contractServiceAdjustmentFields } from './resources/contractServiceAdjustments/description';
import { contractServiceBundleAdjustmentFields } from './resources/contractServiceBundleAdjustments/description';
import { contractServiceBundleFields } from './resources/contractServiceBundles/description';
import { contractServiceBundleUnitFields } from './resources/contractServiceBundleUnits/description';
import { contractMilestoneFields } from './resources/contractMilestones/description';
import { contractServiceUnitFields } from './resources/contractServiceUnits/description';
import { contractBlockFields } from './resources/contractBlocks/description';
import { contractBlockHourFactorFields } from './resources/contractBlockHourFactors/description';
import { contractRateFields } from './resources/contractRates/description';
import { contractRoleCostsFields } from './resources/contractRoleCosts/description';
import { contractExclusionBillingCodeFields } from './resources/contractExclusionBillingCodes/description';
import { contractExclusionRoleFields } from './resources/contractExclusionRoles/description';
import { contractExclusionSetsFields } from './resources/contractExclusionSets/description';
import { contractExclusionSetExcludedRolesFields } from './resources/contractExclusionSetExcludedRoles/description';
import { contractExclusionSetExcludedWorkTypesFields } from './resources/contractExclusionSetExcludedWorkTypes/description';
import { opportunityFields } from './resources/opportunities/description';
import { addOperationsToResource } from './helpers/resource-operations.helper';
import { executeSurveyOperation } from './resources/surveys/execute';
import { surveyFields } from './resources/surveys/description';
import { executeSurveyResultsOperation } from './resources/surveyResults/execute';
import { surveyResultsFields } from './resources/surveyResults/description';
import { executeConfigurationItemOperation } from './resources/configurationItems/execute';
import { configurationItemFields } from './resources/configurationItems/description';
import { executeConfigurationItemTypeOperation } from './resources/configurationItemTypes/execute';
import { configurationItemTypeFields } from './resources/configurationItemTypes/description';
import { executeConfigurationItemCategoryOperation } from './resources/configurationItemCategories/execute';
import { configurationItemCategoryFields } from './resources/configurationItemCategories/description';
import { executeConfigurationItemCategoryUdfAssociationOperation } from './resources/configurationItemCategoryUdfAssociation/execute';
import { configurationItemCategoryUdfAssociationFields } from './resources/configurationItemCategoryUdfAssociation/description';
import { executeConfigurationItemNoteOperation } from './resources/configurationItemNotes/execute';
import { configurationItemNoteFields } from './resources/configurationItemNotes/description';
import { executeConfigurationItemRelatedItemOperation } from './resources/configurationItemRelatedItems/execute';
import { configurationItemRelatedItemFields } from './resources/configurationItemRelatedItems/description';
import { executeConfigurationItemDnsRecordOperation } from './resources/configurationItemDnsRecords/execute';
import { configurationItemDnsRecordFields } from './resources/configurationItemDnsRecords/description';
import { executeConfigurationItemBillingProductAssociationOperation } from './resources/configurationItemBillingProductAssociations/execute';
import { configurationItemBillingProductAssociationFields } from './resources/configurationItemBillingProductAssociations/description';
import { executeConfigurationItemSslSubjectAlternativeNameOperation } from './resources/configurationItemSslSubjectAlternativeNames/execute';
import { configurationItemSslSubjectAlternativeNameFields } from './resources/configurationItemSslSubjectAlternativeNames/description';
import { companyWebhookFields } from './resources/companyWebhooks';
import { configurationItemWebhookFields } from './resources/configurationItemWebhooks';
import { contactWebhookFields } from './resources/contactWebhooks';
import { ticketNoteWebhookFields } from './resources/ticketNoteWebhooks';
import { executeTicketWebhookOperation } from './resources/ticketWebhooks/execute';
import { ticketWebhookFields } from './resources/ticketWebhooks/description';
import { apiThresholdDescription } from './resources/apiThreshold/description';
import { executeApiThresholdOperation } from './resources/apiThreshold/execute';
import { executeContractBillingRuleOperation } from './resources/contractBillingRules/execute';
import { contractBillingRuleFields } from './resources/contractBillingRules/description';
import { executeContractRoleCostsOperation } from './resources/contractRoleCosts/execute';
import { executeContractRetainersOperation } from './resources/contractRetainers/execute';
import { contractRetainersFields } from './resources/contractRetainers/description';
import { executeContractTicketPurchasesOperation } from './resources/contractTicketPurchases/execute';
import { contractTicketPurchasesFields } from './resources/contractTicketPurchases/description';
import { executeCountryOperation } from './resources/countries/execute';
import { executeDomainRegistrarOperation } from './resources/domainRegistrar/execute';
import { domainRegistrarFields } from './resources/domainRegistrar/description';
import { executeSkillOperation } from './resources/skills/execute';
import { skillFields } from './resources/skills/description';
import { contactGroupsFields } from './resources/contactGroups/description';
import { executeContactGroupContactsOperation } from './resources/contactGroupContacts/execute';
import { contactGroupContactsFields } from './resources/contactGroupContacts/description';
import { aiHelperFields } from './resources/aiHelper/description';
import { executeAiHelperOperation } from './resources/aiHelper/execute';
import { toolFieldsWithAgentOptions } from './resources/tool/description';
import { executeToolOperation } from './resources/tool/execute';
import { getQueryableEntities, getEntityFields, getTicketStatuses, getTaskStatuses, getQueueOptions, getResourceOptions, getResourceOperations } from './helpers/options';
import { EntityHelper } from './helpers/entity';
import { executeQuoteOperation } from './resources/quotes/execute';
import { quoteFields } from './resources/quotes/description';
import { executeQuoteItemOperation } from './resources/quoteItems/execute';
import { quoteItemFields } from './resources/quoteItems/description';
import { executeQuoteLocationOperation } from './resources/quoteLocations/execute';
import { quoteLocationFields } from './resources/quoteLocations/description';
import { executeQuoteTemplateOperation } from './resources/quoteTemplates/execute';
import { quoteTemplateFields } from './resources/quoteTemplates/description';
import { executeServiceCallTicketResourceOperation } from './resources/serviceCallTicketResources/execute';
import { serviceCallTicketResourceFields } from './resources/serviceCallTicketResources/description';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { countryFields } from './resources/countries/description';

// -----------------------------------------------------------------------------
// Memoisation cache for select-columns dropdown.  Key = credentialsId|resource
// This lives at module scope so all Autotask nodes in the editor share it.
// -----------------------------------------------------------------------------
const selectColumnsCache: Map<string, INodePropertyOptions[]> = new Map();

/**
 * Autotask node implementation
 */
export class Autotask implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autotask',
		name: 'autotask',
		icon: 'file:autotask.svg',
		group: ['transform'],
		usableAsTool: true,
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Kaseya\'s Autotask PSA REST API to manage companies, tickets, contracts, and more.',
		codex: {
			categories: ['Business', 'Customer Management', 'Operations', 'Sales & CRM'],
			resources: {
				primaryDocumentation: [
					{
						url: 'https://github.com/msoukhomlinov/n8n-nodes-autotask',
					},
					{
						url: 'https://ww6.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm',
					},
				],
			},
		},
		defaults: {
			name: 'Autotask',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'autotaskApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: RESOURCE_DEFINITIONS,
				default: '',
				required: true,
			},
			...aiHelperFields,
			...toolFieldsWithAgentOptions,
			...addOperationsToResource(apiThresholdDescription, {
				resourceName: 'apiThreshold',
				excludeOperations: [
					'entityInfo',
					'getMany',
					'getManyAdvanced',
					'picklistLabels',
					'referenceLabels',
					'selectColumns',
					'flattenUdfs'
				]
			}),
			...addOperationsToResource(companyFields, { resourceName: 'company' }),
			...addOperationsToResource(companyAlertFields, { resourceName: 'companyAlert' }),
			...addOperationsToResource(companyNoteFields, { resourceName: 'companyNote' }),
			...addOperationsToResource(companySiteConfigurationFields, { resourceName: 'companySiteConfiguration' }),
			...addOperationsToResource(companyWebhookFields, { resourceName: 'companyWebhook' }),
			...addOperationsToResource(configurationItemWebhookFields, { resourceName: 'configurationItemWebhook' }),
			...addOperationsToResource(configurationItemFields, { resourceName: 'configurationItems' }),
			...addOperationsToResource(configurationItemCategoryFields, { resourceName: 'configurationItemCategories' }),
			...addOperationsToResource(configurationItemCategoryUdfAssociationFields, { resourceName: 'configurationItemCategoryUdfAssociation' }),
			...addOperationsToResource(configurationItemTypeFields, { resourceName: 'configurationItemTypes' }),
			...addOperationsToResource(configurationItemNoteFields, { resourceName: 'configurationItemNote' }),
			...addOperationsToResource(configurationItemRelatedItemFields, { resourceName: 'configurationItemRelatedItem' }),
			...addOperationsToResource(configurationItemDnsRecordFields, { resourceName: 'configurationItemDnsRecord' }),
			...addOperationsToResource(configurationItemBillingProductAssociationFields, { resourceName: 'configurationItemBillingProductAssociation' }),
			...addOperationsToResource(configurationItemSslSubjectAlternativeNameFields, { resourceName: 'configurationItemSslSubjectAlternativeName' }),
			...addOperationsToResource(contactFields, { resourceName: 'contact' }),
			...addOperationsToResource(contactWebhookFields, { resourceName: 'contactWebhook' }),
			...addOperationsToResource(contactGroupsFields, { resourceName: 'contactGroups' }),
			...addOperationsToResource(contactGroupContactsFields, { resourceName: 'contactGroupContacts' }),
			...addOperationsToResource(companyLocationFields, { resourceName: 'companyLocation' }),
			...addOperationsToResource(domainRegistrarFields, { resourceName: 'DomainRegistrar' }),
			...addOperationsToResource(contractFields, { resourceName: 'contract' }),
			...addOperationsToResource(contractChargeFields, { resourceName: 'contractCharge' }),
			...addOperationsToResource(contractNoteFields, { resourceName: 'contractNote' }),
			...addOperationsToResource(contractServiceFields, { resourceName: 'contractService' }),
			...addOperationsToResource(contractBillingRuleFields, { resourceName: 'contractBillingRule' }),
			...addOperationsToResource(contractRoleCostsFields, { resourceName: 'contractRoleCosts' }),
			...addOperationsToResource(contractRetainersFields, { resourceName: 'contractRetainer' }),
			...addOperationsToResource(contractTicketPurchasesFields, { resourceName: 'contractTicketPurchase' }),
			...addOperationsToResource(contractServiceBundleFields, { resourceName: 'contractServiceBundle' }),
			...addOperationsToResource(contractServiceBundleUnitFields, { resourceName: 'contractServiceBundleUnit' }),
			...addOperationsToResource(contractMilestoneFields, { resourceName: 'contractMilestone' }),
			...addOperationsToResource(contractServiceUnitFields, { resourceName: 'contractServiceUnit' }),
			...addOperationsToResource(contractBlockFields, { resourceName: 'contractBlock' }),
			...addOperationsToResource(contractBlockHourFactorFields, { resourceName: 'contractBlockHourFactor' }),
			...addOperationsToResource(contractRateFields, { resourceName: 'contractRate' }),
			...addOperationsToResource(contractExclusionBillingCodeFields, { resourceName: 'contractExclusionBillingCode' }),
			...addOperationsToResource(contractExclusionRoleFields, { resourceName: 'contractExclusionRoles' }),
			...addOperationsToResource(contractExclusionSetsFields, { resourceName: 'contractExclusionSets' }),
			...addOperationsToResource(contractExclusionSetExcludedRolesFields, { resourceName: 'contractExclusionSetExcludedRole' }),
			...addOperationsToResource(contractExclusionSetExcludedWorkTypesFields, { resourceName: 'contractExclusionSetExcludedWorkType' }),
			...addOperationsToResource(countryFields, {
				resourceName: 'country',
				excludeOperations: ['getManyAdvanced']
			}),
			...addOperationsToResource(holidaySetFields, { resourceName: 'holidaySet' }),
			...addOperationsToResource(holidayFields, { resourceName: 'holiday' }),
			...addOperationsToResource(invoiceFields, { resourceName: 'invoice' }),
			...addOperationsToResource(notificationHistoryFields, { resourceName: 'notificationHistory' }),
			...addOperationsToResource(opportunityFields, { resourceName: 'opportunity' }),
			...addOperationsToResource(productFields, { resourceName: 'product' }),
			...addOperationsToResource(productVendorFields, { resourceName: 'productVendor' }),
			...addOperationsToResource(projectFields, { resourceName: 'project' }),
			...addOperationsToResource(projectChargeFields, { resourceName: 'projectCharge' }),
			...addOperationsToResource(projectNoteFields, { resourceName: 'projectNote' }),
			...addOperationsToResource(projectPhaseFields, { resourceName: 'phase' }),
			...addOperationsToResource(projectTaskFields, { resourceName: 'task' }),
			...addOperationsToResource(quoteFields, { resourceName: 'quote' }),
			...addOperationsToResource(quoteItemFields, { resourceName: 'quoteItem' }),
			...addOperationsToResource(quoteLocationFields, { resourceName: 'quoteLocation' }),
			...addOperationsToResource(quoteTemplateFields, { resourceName: 'quoteTemplate' }),
			...addOperationsToResource(resourceFields, { resourceName: 'resource' }),
			...addOperationsToResource(resourceRoleFields, { resourceName: 'resourceRole' }),
			...addOperationsToResource(roleFields, { resourceName: 'role' }),
			...addOperationsToResource(serviceCallFields, { resourceName: 'serviceCall' }),
			...addOperationsToResource(serviceCallTicketFields, { resourceName: 'serviceCallTicket' }),
			...addOperationsToResource(serviceCallTicketResourceFields, { resourceName: 'serviceCallTicketResource' }),
			...addOperationsToResource(serviceCallTaskFields, { resourceName: 'serviceCallTask' }),
			...addOperationsToResource(serviceCallTaskResourceFields, { resourceName: 'serviceCallTaskResource' }),
			...addOperationsToResource(serviceLevelAgreementResultFields, { resourceName: 'serviceLevelAgreementResult' }),
			...addOperationsToResource(serviceFields, { resourceName: 'service' }),
			...addOperationsToResource(subscriptionFields, { resourceName: 'subscription' }),
			...addOperationsToResource(subscriptionPeriodsFields, { resourceName: 'subscriptionPeriod' }),
			...addOperationsToResource(tagFields, { resourceName: 'tag' }),
			...addOperationsToResource(tagAliasFields, { resourceName: 'tagAlias' }),
			...addOperationsToResource(tagGroupFields, { resourceName: 'tagGroup' }),
			...addOperationsToResource(ticketFields, { resourceName: 'ticket' }),
			...addOperationsToResource(ticketChangeRequestApprovalFields, { resourceName: 'ticketChangeRequestApproval' }),
			...addOperationsToResource(ticketChargeFields, { resourceName: 'ticketCharge' }),
			...addOperationsToResource(ticketChecklistItemFields, { resourceName: 'ticketChecklistItem' }),
			...addOperationsToResource(ticketChecklistLibraryFields, { resourceName: 'ticketChecklistLibrary' }),
			...addOperationsToResource(ticketNoteFields, { resourceName: 'ticketNote' }),
			...addOperationsToResource(ticketNoteAttachmentFields, { resourceName: 'ticketNoteAttachment' }),
			...addOperationsToResource(ticketAttachmentFields, { resourceName: 'ticketAttachment' }),
			...addOperationsToResource(ticketNoteWebhookFields, { resourceName: 'ticketNoteWebhook' }),
			...addOperationsToResource(ticketWebhookFields, { resourceName: 'ticketWebhook' }),
			...addOperationsToResource(ticketCategoryFields, { resourceName: 'ticketCategory' }),
			...addOperationsToResource(ticketCategoryFieldDefaultFields, { resourceName: 'ticketCategoryFieldDefault' }),
			...addOperationsToResource(ticketSecondaryResourceFields, { resourceName: 'ticketSecondaryResource' }),
			...addOperationsToResource(ticketHistoryFields, { resourceName: 'TicketHistory' }),
			...addOperationsToResource(timeEntryFields, { resourceName: 'timeEntry' }),
			...addOperationsToResource(timeEntryAttachmentFields, { resourceName: 'timeEntryAttachment' }),
			...addOperationsToResource(billingCodeFields, { resourceName: 'billingCode' }),
			...addOperationsToResource(billingItemsFields, { resourceName: 'billingItems' }),
			...addOperationsToResource(checklistLibraryFields, { resourceName: 'checklistLibrary' }),
			...addOperationsToResource(checklistLibraryChecklistItemFields, { resourceName: 'checklistLibraryChecklistItem' }),
			...addOperationsToResource(classificationIconFields, { resourceName: 'classificationIcon' }),
			...addOperationsToResource(surveyFields, { resourceName: 'survey' }),
			...addOperationsToResource(surveyResultsFields, { resourceName: 'surveyResults' }),
			...contractServiceAdjustmentFields,
			...contractServiceBundleAdjustmentFields,
			...searchFilterDescription,
			...searchFilterOperations,
			...addOperationsToResource(skillFields, { resourceName: 'skill' }),
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Initialise rate tracker with actual Autotask usage.
		// This uses a cooldown guard, so multiple concurrent executions
		// will not all trigger a threshold information request.
		await initializeRateTracker(this);

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Handle resource-specific operations
		switch (resource) {
			case 'aiHelper':
				return executeAiHelperOperation.call(this);
			case 'tool':
				return executeToolOperation.call(this);
			case 'apiThreshold':
				return executeApiThresholdOperation.call(this);
			case 'billingCode':
				return executeBillingCodeOperation.call(this);
			case 'billingItems':
				return executeBillingItemsOperation.call(this);
			case 'checklistLibrary':
				return executeChecklistLibraryOperation.call(this);
			case 'checklistLibraryChecklistItem':
				return executeChecklistLibraryChecklistItemOperation.call(this);
			case 'classificationIcon':
				return executeClassificationIconOperation.call(this);
			case 'company':
				return executeCompanyOperation.call(this);
			case 'companyAlert':
				return executeCompanyAlertOperation.call(this);
			case 'companyNote':
				return executeCompanyNoteOperation.call(this);
			case 'companySiteConfiguration':
				return executeCompanySiteConfigurationOperation.call(this);
			case 'companyWebhook':
				return executeCompanyWebhookOperation.call(this);
			case 'configurationItemWebhook':
				return executeConfigurationItemWebhookOperation.call(this);
			case 'configurationItems':
				return executeConfigurationItemOperation.call(this);
			case 'configurationItemCategories':
				return executeConfigurationItemCategoryOperation.call(this);
			case 'configurationItemCategoryUdfAssociation':
				return executeConfigurationItemCategoryUdfAssociationOperation.call(this);
			case 'configurationItemNote':
				return executeConfigurationItemNoteOperation.call(this);
			case 'configurationItemTypes':
				return executeConfigurationItemTypeOperation.call(this);
			case 'configurationItemRelatedItem':
				return executeConfigurationItemRelatedItemOperation.call(this);
			case 'configurationItemDnsRecord':
				return executeConfigurationItemDnsRecordOperation.call(this);
			case 'configurationItemBillingProductAssociation':
				return executeConfigurationItemBillingProductAssociationOperation.call(this);
			case 'configurationItemSslSubjectAlternativeName':
				return executeConfigurationItemSslSubjectAlternativeNameOperation.call(this);
			case 'contact':
				return executeContactOperation.call(this);
			case 'contactWebhook':
				return executeContactWebhookOperation.call(this);
			case 'contactGroups':
				return executeContactGroupsOperation.call(this);
			case 'contactGroupContacts':
				return executeContactGroupContactsOperation.call(this);
			case 'companyLocation':
				return executeCompanyLocationOperation.call(this);
			case 'contract':
				return executeContractOperation.call(this);
			case 'contractBillingRule':
				return executeContractBillingRuleOperation.call(this);
			case 'contractCharge':
				return executeContractChargeOperation.call(this);
			case 'contractNote':
				return executeContractNoteOperation.call(this);
			case 'contractService':
				return executeContractServiceOperation.call(this);
			case 'contractServiceAdjustment':
				return executeContractServiceAdjustmentOperation.call(this);
			case 'contractServiceBundleAdjustment':
				return executeContractServiceBundleAdjustmentOperation.call(this);
			case 'contractServiceBundle':
				return executeContractServiceBundleOperation.call(this);
			case 'contractServiceBundleUnit':
				return executeContractServiceBundleUnitOperation.call(this);
			case 'contractMilestone':
				return executeContractMilestoneOperation.call(this);
			case 'contractServiceUnit':
				return executeContractServiceUnitOperation.call(this);
			case 'contractBlock':
				return executeContractBlockOperation.call(this);
			case 'contractBlockHourFactor':
				return executeContractBlockHourFactorOperation.call(this);
			case 'contractRate':
				return executeContractRateOperation.call(this);
			case 'contractRoleCosts':
				return executeContractRoleCostsOperation.call(this);
			case 'contractRetainer':
				return executeContractRetainersOperation.call(this);
			case 'contractTicketPurchase':
				return executeContractTicketPurchasesOperation.call(this);
			case 'country':
				return executeCountryOperation.call(this);
			case 'DomainRegistrar':
				return executeDomainRegistrarOperation.call(this);
			case 'contractExclusionBillingCode':
				return executeContractExclusionBillingCodeOperation.call(this);
			case 'contractExclusionRoles':
				return executeContractExclusionRoleOperation.call(this);
			case 'contractExclusionSets':
				return executeContractExclusionSetsOperation.call(this);
			case 'contractExclusionSetExcludedRole':
				return executeContractExclusionSetExcludedRolesOperation.call(this);
			case 'contractExclusionSetExcludedWorkType':
				return executeContractExclusionSetExcludedWorkTypesOperation.call(this);
			case 'holidaySet':
				return executeHolidaySetOperation.call(this);
			case 'holiday':
				return executeHolidayOperation.call(this);
			case 'invoice':
				return executeInvoiceOperation.call(this);
			case 'notificationHistory':
				return executeNotificationHistoryOperation.call(this);
			case 'opportunity':
				return executeOpportunityOperation.call(this);
			case 'product':
				return executeProductOperation.call(this);
			case 'productVendor':
				return executeProductVendorOperation.call(this);
			case 'project':
				return executeProjectOperation.call(this);
			case 'projectCharge':
				return executeProjectChargeOperation.call(this);
			case 'projectNote':
				return executeProjectNoteOperation.call(this);
			case 'phase':
				return executeProjectPhaseOperation.call(this);
			case 'task':
				return executeProjectTaskOperation.call(this);
			case 'quote':
				return executeQuoteOperation.call(this);
			case 'quoteItem':
				return executeQuoteItemOperation.call(this);
			case 'quoteLocation':
				return executeQuoteLocationOperation.call(this);
			case 'quoteTemplate':
				return executeQuoteTemplateOperation.call(this);
			case 'resource':
				return executeResourceOperation.call(this);
			case 'resourceRole':
				return executeResourceRoleOperation.call(this);
			case 'role':
				return executeRoleOperation.call(this);
			case 'searchFilter':
				if (operation === 'dynamicBuild') {
					return executeDynamicSearchFilterOperation.call(this);
				}
				return executeSearchFilterOperation.call(this);
			case 'serviceCall':
				return executeServiceCallOperation.call(this);
			case 'serviceCallTicket':
				return executeServiceCallTicketOperation.call(this);
			case 'serviceCallTicketResource':
				return executeServiceCallTicketResourceOperation.call(this);
			case 'serviceCallTask':
				return executeServiceCallTaskOperation.call(this);
			case 'serviceCallTaskResource':
				return executeServiceCallTaskResourceOperation.call(this);
			case 'serviceLevelAgreementResult':
				return executeServiceLevelAgreementResultOperation.call(this);
			case 'service':
				return executeServiceOperation.call(this);
			case 'subscription':
				return executeSubscriptionOperation.call(this);
			case 'subscriptionPeriod':
				return executeSubscriptionPeriodsOperation.call(this);
			case 'tag':
				return executeTagOperation.call(this);
			case 'tagAlias':
				return executeTagAliasOperation.call(this);
			case 'tagGroup':
				return executeTagGroupOperation.call(this);
			case 'ticket':
				return executeTicketOperation.call(this);
			case 'ticketChangeRequestApproval':
				return executeTicketChangeRequestApprovalOperation.call(this);
			case 'ticketCharge':
				return executeTicketChargeOperation.call(this);
			case 'ticketChecklistItem':
				return executeTicketChecklistItemOperation.call(this);
			case 'ticketChecklistLibrary':
				return executeTicketChecklistLibraryOperation.call(this);
			case 'ticketCategory':
				return executeTicketCategoryOperation.call(this);
			case 'ticketCategoryFieldDefault':
				return executeTicketCategoryFieldDefaultOperation.call(this);
			case 'ticketSecondaryResource':
				return executeTicketSecondaryResourceOperation.call(this);
			case 'ticketNote':
				return executeTicketNoteOperation.call(this);
			case 'ticketNoteAttachment':
				return executeTicketNoteAttachmentOperation.call(this);
			case 'ticketAttachment':
				return executeTicketAttachmentOperation.call(this);
			case 'ticketNoteWebhook':
				return executeTicketNoteWebhookOperation.call(this);
			case 'ticketWebhook':
				return executeTicketWebhookOperation.call(this);
			case 'TicketHistory':
				return executeTicketHistoryOperation.call(this);
			case 'timeEntry':
				return executeTimeEntryOperation.call(this);
			case 'timeEntryAttachment':
				return executeTimeEntryAttachmentOperation.call(this);
			case 'survey':
				return executeSurveyOperation.call(this);
			case 'surveyResults':
				return executeSurveyResultsOperation.call(this);
			case 'skill':
				return executeSkillOperation.call(this);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`Resource ${resource} is not supported`
				);
		}
	}

	methods = {
		resourceMapping: {
			async getFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				return getResourceMapperFields.call(this, this.getNodeParameter('resource', 0) as string);
			},
			/**
			 * Get fields for tool resource based on target resource and operation
			 */
			async getToolFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
                                const toolOperation = this.getNodeParameter('toolOperation', 0) as string;

                                if (!toolOperation) {
                                        return { fields: [] };
                                }

                                // Parse tool operation to get resource and operation
                                const parsed = toolOperation.split('.');
                                if (parsed.length !== 2) {
                                        return { fields: [] };
                                }

                                const [targetResource, resourceOperation] = parsed;

                                // Resolve canonical resource name from metadata for case-insensitive matching
                                const canonicalResource = getEntityMetadata(targetResource)?.name ?? targetResource;

                                // Temporarily override getNodeParameter to return target resource values
                                const originalGetNodeParameter = this.getNodeParameter as (
                                        name: string,
                                        index: number,
                                        fallbackValue?: unknown,
                                        options?: IGetNodeParameterOptions,
                                ) => unknown;
                                this.getNodeParameter = ((
                                        name: string,
                                        index: number,
                                        fallbackValue?: unknown,
                                        options?: IGetNodeParameterOptions,
                                ): unknown => {
                                        if (name === 'resource') return canonicalResource;
                                        if (name === 'operation') return resourceOperation;
                                        return originalGetNodeParameter.call(this, name, index, fallbackValue, options);
                                }) as typeof this.getNodeParameter;

                                try {
                                        // Reuse existing field discovery for the target resource
                                        return await getResourceMapperFields.call(this, canonicalResource);
                                } finally {
                                        // Restore original method
                                        this.getNodeParameter = originalGetNodeParameter as typeof this.getNodeParameter;
                                }
			},
		},
		loadOptions: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			async getSelectColumns(this: ILoadOptionsFunctions) {
				const resource = this.getNodeParameter('resource', 0) as string;

				// Identify credentials so different tenants don't share cached metadata
				let credentialId = 'anonymous';
				try {
					const creds = await this.getCredentials('autotaskApi') as { id?: string; credentialsId?: string; username?: string };
					credentialId = (creds?.id ?? creds?.credentialsId ?? creds?.username ?? 'anonymous').toString();
				} catch {
					// ignore – keep default id
				}

				const cacheKey = `${credentialId}|${resource}`;

				if (selectColumnsCache.has(cacheKey)) {
					console.debug(`[getSelectColumns] Using cached options for key: ${cacheKey}`);
					return selectColumnsCache.get(cacheKey)!;
				}

				console.debug(`[getSelectColumns] Cache miss for ${cacheKey}. Loading from API…`);

				try {
					// Fetch combined standard + UDF fields
					const { fields } = await getResourceMapperFields.call(this, resource);

					// Strip heavy picklist arrays to minimise payload held in memory/UI
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					for (const f of fields as any[]) {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						if ((f as any).picklistValues !== undefined) {
							delete (f as any).picklistValues;
						}
					}

					// Diagnostic counts (optional)
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const udfFields = (fields as any[]).filter(f => (f as any).isUdf === true || String(f.id).startsWith('UDF'));
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const picklistFields = (fields as any[]).filter(f => (f as any).isPickList === true);

					console.debug(`[getSelectColumns] Stats for ${resource} – total:${fields.length}, udf:${udfFields.length}, picklist:${picklistFields.length}`);

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const formattedOptions: INodePropertyOptions[] = (fields as any[]).map((field: any) => ({
						name: field.displayName || field.label || field.name || field.id,
						value: field.id,
					}));

					// Store in cache for future calls
					selectColumnsCache.set(cacheKey, formattedOptions);

					return formattedOptions;
				} catch (error) {
					console.error(`Error loading select columns options for ${resource}:`, error.message || error);
					return [];
				}
			},
			getQueryableEntities,
			getEntityFields,
			/**
			 * Get picklist values for Contracts.contractType
			 */
			async getContractTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const helper = new EntityHelper('Contracts', this);
					const values = await helper.getPicklistValues('contractType');
					const sorted = values
						.filter((v) => v.isActive)
						.map((v) => ({
							name: v.label || `Type ${v.value}`,
							value: v.value,
						}))
						.sort((a, b) => a.name.localeCompare(b.name));
					return [{ name: 'All Contract Types', value: '' }, ...sorted];
				} catch (error) {
					console.error('Error loading contract types:', (error as Error).message);
					return [{ name: 'All Contract Types', value: '' }];
				}
			},

			getTicketStatuses,
			getTaskStatuses,
			getQueueOptions,
			getResourceOptions,
			getResourceOperations,
		},
	};
}
