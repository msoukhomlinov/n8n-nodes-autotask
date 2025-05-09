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
import { executeCompanyWebhookOperation } from './resources/companyWebhooks/execute';
import { executeConfigurationItemWebhookOperation } from './resources/configurationItemWebhooks/execute';
import { executeTicketNoteWebhookOperation } from './resources/ticketNoteWebhooks/execute';
import { executeProjectNoteOperation } from './resources/projectNotes/execute';
import { executeProjectPhaseOperation } from './resources/projectPhases/execute';
import { executeProjectChargeOperation } from './resources/projectCharges/execute';
import { executeProductOperation } from './resources/products/execute';
import { executeProductVendorOperation } from './resources/productVendors/execute';
import { executeTicketOperation } from './resources/tickets/execute';
import { executeTicketNoteOperation } from './resources/ticketNotes/execute';
import { executeTicketHistoryOperation } from './resources/ticketHistories/execute';
import { executeTimeEntryOperation } from './resources/timeEntries/execute';
import { executeBillingCodeOperation } from './resources/billingCodes/execute';
import { executeHolidaySetOperation } from './resources/holidaySets/execute';
import { executeHolidayOperation } from './resources/holidays/execute';
import { executeInvoiceOperation } from './resources/invoices/execute';
import { executeNotificationHistoryOperation } from './resources/notificationHistory/execute';
import { executeServiceCallOperation } from './resources/serviceCalls/execute';
import { executeServiceOperation } from './resources/services/execute';
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
import { executeContractExclusionSetsOperation } from './resources/contract-exclusion-sets/execute';
import { executeContractExclusionSetExcludedRolesOperation } from './resources/contractExclusionSetExcludedRoles/execute';
import { executeContractExclusionSetExcludedWorkTypesOperation } from './resources/contractExclusionSetExcludedWorkTypes/execute';
import { executeOpportunityOperation } from './resources/opportunities/execute';
import { searchFilterDescription, searchFilterOperations, build as executeSearchFilterOperation, dynamicBuild as executeDynamicSearchFilterOperation } from './resources/searchFilter';
import { getResourceMapperFields } from './helpers/resourceMapper';
import { RESOURCE_DEFINITIONS } from './resources/definitions';
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
import { projectNoteFields } from './resources/projectNotes/description';
import { projectPhaseFields } from './resources/projectPhases/description';
import { projectChargeFields } from './resources/projectCharges/description';
import { productFields } from './resources/products/description';
import { productVendorFields } from './resources/productVendors/description';
import { ticketFields } from './resources/tickets/description';
import { ticketHistoryFields } from './resources/ticketHistories/description';
import { ticketNoteFields } from './resources/ticketNotes/description';
import { timeEntryFields } from './resources/timeEntries/description';
import { billingCodeFields } from './resources/billingCodes/description';
import { holidaySetFields } from './resources/holidaySets/description';
import { holidayFields } from './resources/holidays/description';
import { invoiceFields } from './resources/invoices/description';
import { notificationHistoryFields } from './resources/notificationHistory/description';
import { serviceCallFields } from './resources/serviceCalls/description';
import { serviceFields } from './resources/services/description';
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
import { contractExclusionSetsFields } from './resources/contract-exclusion-sets/description';
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
import { executeDomainRegistrarOperation } from './resources/domainRegistrar/execute';
import { domainRegistrarFields } from './resources/domainRegistrar/description';
import { executeSkillOperation } from './resources/skills/execute';
import { skillFields } from './resources/skills/description';
import { contactGroupsFields } from './resources/contactGroups/description';
import { executeContactGroupContactsOperation } from './resources/contactGroupContacts/execute';
import { contactGroupContactsFields } from './resources/contactGroupContacts/description';
import { getQueryableEntities, getEntityFields } from './helpers/options';
import { executeQuoteOperation } from './resources/quotes/execute';
import { quoteFields } from './resources/quotes/description';
import { executeQuoteItemOperation } from './resources/quoteItems/execute';
import { quoteItemFields } from './resources/quoteItems/description';
import { executeQuoteLocationOperation } from './resources/quoteLocations/execute';
import { quoteLocationFields } from './resources/quoteLocations/description';
import { executeQuoteTemplateOperation } from './resources/quoteTemplates/execute';
import { quoteTemplateFields } from './resources/quoteTemplates/description';

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
			...addOperationsToResource(serviceFields, { resourceName: 'service' }),
			...addOperationsToResource(ticketFields, { resourceName: 'ticket' }),
			...addOperationsToResource(ticketNoteFields, { resourceName: 'ticketNote' }),
			...addOperationsToResource(ticketNoteWebhookFields, { resourceName: 'ticketNoteWebhook' }),
			...addOperationsToResource(ticketWebhookFields, { resourceName: 'ticketWebhook' }),
			...addOperationsToResource(ticketHistoryFields, { resourceName: 'TicketHistory' }),
			...addOperationsToResource(timeEntryFields, { resourceName: 'timeEntry' }),
			...addOperationsToResource(billingCodeFields, { resourceName: 'billingCode' }),
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
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Handle resource-specific operations
		switch (resource) {
			case 'apiThreshold':
				return executeApiThresholdOperation.call(this);
			case 'billingCode':
				return executeBillingCodeOperation.call(this);
			case 'company':
				return executeCompanyOperation.call(this);
			case 'companyAlert':
				return executeCompanyAlertOperation.call(this);
			case 'companyNote':
				return executeCompanyNoteOperation.call(this);
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
			case 'service':
				return executeServiceOperation.call(this);
			case 'ticket':
				return executeTicketOperation.call(this);
			case 'ticketNote':
				return executeTicketNoteOperation.call(this);
			case 'ticketNoteWebhook':
				return executeTicketNoteWebhookOperation.call(this);
			case 'ticketWebhook':
				return executeTicketWebhookOperation.call(this);
			case 'TicketHistory':
				return executeTicketHistoryOperation.call(this);
			case 'timeEntry':
				return executeTimeEntryOperation.call(this);
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
		},
		loadOptions: {
			async getSelectColumns(this: ILoadOptionsFunctions) {
				const resource = this.getNodeParameter('resource', 0) as string;
				console.debug(`[getSelectColumns] Starting to load column options for resource: ${resource}`);

				try {
					// Get fields using the same function that powers the resource mapper
					console.debug(`[getSelectColumns] Calling getResourceMapperFields for ${resource}`);
					const { fields } = await getResourceMapperFields.call(this, resource);
					console.debug(`[getSelectColumns] Retrieved ${fields.length} fields for ${resource}`);

					// Count UDF fields and picklist fields
					const udfFields = fields.filter(field => field.id.startsWith('UDF') || 'isUdf' in field && field.isUdf === true);
					const picklistFields = fields.filter(field => 'isPickList' in field && field.isPickList === true);
					const udfPicklistFields = udfFields.filter(field => 'isPickList' in field && field.isPickList === true);

					console.debug(`[getSelectColumns] Field breakdown for ${resource}:
- Total fields: ${fields.length}
- UDF fields: ${udfFields.length}
- Picklist fields: ${picklistFields.length}
- UDF Picklist fields: ${udfPicklistFields.length}`);

					if (udfPicklistFields.length > 0) {
						console.debug('[getSelectColumns] First few UDF picklist fields:',
							udfPicklistFields.slice(0, 3).map(f => ({
								id: f.id,
								displayName: f.displayName,
								hasOptions: 'options' in f && Array.isArray(f.options) && f.options.length > 0
							}))
						);
					}

					// Format fields for multiOptions
					const formattedOptions = fields.map(field => ({
						name: field.displayName || field.id,
						value: field.id,
					}));
					console.debug(`[getSelectColumns] Formatted ${formattedOptions.length} options for the dropdown`);

					return formattedOptions;
				} catch (error) {
					console.error(`Error loading select columns options: ${error.message}`);
					return [];
				}
			},
			getQueryableEntities,
			getEntityFields,
		},
	};
}
