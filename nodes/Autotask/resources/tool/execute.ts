import type { IExecuteFunctions, INodeExecutionData, IGetNodeParameterOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Import all existing resource executors
import { executeAiHelperOperation } from '../aiHelper/execute';
import { executeApiThresholdOperation } from '../apiThreshold/execute';
import { executeBillingCodeOperation } from '../billingCodes/execute';
import { executeCompanyOperation } from '../companies/execute';
import { executeCompanyAlertOperation } from '../companyAlerts/execute';
import { executeCompanyNoteOperation } from '../companyNotes/execute';
import { executeCompanySiteConfigurationOperation } from '../companySiteConfigurations/execute';
import { executeCompanyWebhookOperation } from '../companyWebhooks/execute';
import { executeConfigurationItemWebhookOperation } from '../configurationItemWebhooks/execute';
import { executeConfigurationItemOperation } from '../configurationItems/execute';
import { executeConfigurationItemCategoryOperation } from '../configurationItemCategories/execute';
import { executeConfigurationItemCategoryUdfAssociationOperation } from '../configurationItemCategoryUdfAssociation/execute';
import { executeConfigurationItemNoteOperation } from '../configurationItemNotes/execute';
import { executeConfigurationItemTypeOperation } from '../configurationItemTypes/execute';
import { executeConfigurationItemRelatedItemOperation } from '../configurationItemRelatedItems/execute';
import { executeConfigurationItemDnsRecordOperation } from '../configurationItemDnsRecords/execute';
import { executeConfigurationItemBillingProductAssociationOperation } from '../configurationItemBillingProductAssociations/execute';
import { executeConfigurationItemSslSubjectAlternativeNameOperation } from '../configurationItemSslSubjectAlternativeNames/execute';
import { executeContactOperation } from '../contacts/execute';
import { executeContactWebhookOperation } from '../contactWebhooks/execute';
import { executeContactGroupsOperation } from '../contactGroups/execute';
import { executeContactGroupContactsOperation } from '../contactGroupContacts/execute';
import { executeCompanyLocationOperation } from '../companyLocations/execute';
import { executeContractOperation } from '../contracts/execute';
import { executeContractBillingRuleOperation } from '../contractBillingRules/execute';
import { executeContractChargeOperation } from '../contractCharges/execute';
import { executeContractNoteOperation } from '../contractNotes/execute';
import { executeContractServiceOperation } from '../contractServices/execute';
import { executeContractServiceAdjustmentOperation } from '../contractServiceAdjustments/execute';
import { executeContractServiceBundleAdjustmentOperation } from '../contractServiceBundleAdjustments/execute';
import { executeContractServiceBundleOperation } from '../contractServiceBundles/execute';
import { executeContractServiceBundleUnitOperation } from '../contractServiceBundleUnits/execute';
import { executeContractMilestoneOperation } from '../contractMilestones/execute';
import { executeContractServiceUnitOperation } from '../contractServiceUnits/execute';
import { executeContractBlockOperation } from '../contractBlocks/execute';
import { executeContractBlockHourFactorOperation } from '../contractBlockHourFactors/execute';
import { executeContractRateOperation } from '../contractRates/execute';
import { executeContractRoleCostsOperation } from '../contractRoleCosts/execute';
import { executeContractRetainersOperation } from '../contractRetainers/execute';
import { executeContractTicketPurchasesOperation } from '../contractTicketPurchases/execute';
import { executeContractExclusionBillingCodeOperation } from '../contractExclusionBillingCodes/execute';
import { executeContractExclusionRoleOperation } from '../contractExclusionRoles/execute';
import { executeContractExclusionSetsOperation } from '../contract-exclusion-sets/execute';
import { executeContractExclusionSetExcludedRolesOperation } from '../contractExclusionSetExcludedRoles/execute';
import { executeContractExclusionSetExcludedWorkTypesOperation } from '../contractExclusionSetExcludedWorkTypes/execute';
import { executeCountryOperation } from '../countries/execute';
import { executeDomainRegistrarOperation } from '../domainRegistrar/execute';
import { executeHolidaySetOperation } from '../holidaySets/execute';
import { executeHolidayOperation } from '../holidays/execute';
import { executeInvoiceOperation } from '../invoices/execute';
import { executeNotificationHistoryOperation } from '../notificationHistory/execute';
import { executeOpportunityOperation } from '../opportunities/execute';
import { executeProductOperation } from '../products/execute';
import { executeProductVendorOperation } from '../productVendors/execute';
import { executeProjectOperation } from '../projects/execute';
import { executeProjectChargeOperation } from '../projectCharges/execute';
import { executeProjectNoteOperation } from '../projectNotes/execute';
import { executeProjectPhaseOperation } from '../projectPhases/execute';
import { executeProjectTaskOperation } from '../projectTasks/execute';
import { executeQuoteOperation } from '../quotes/execute';
import { executeQuoteItemOperation } from '../quoteItems/execute';
import { executeQuoteLocationOperation } from '../quoteLocations/execute';
import { executeQuoteTemplateOperation } from '../quoteTemplates/execute';
import { executeResourceOperation } from '../resources/execute';
import { executeResourceRoleOperation } from '../resourceRoles/execute';
import { executeRoleOperation } from '../roles/execute';
import { executeServiceCallOperation } from '../serviceCalls/execute';
import { executeServiceCallTicketOperation } from '../serviceCallTickets/execute';
import { executeServiceCallTicketResourceOperation } from '../serviceCallTicketResources/execute';
import { executeServiceCallTaskOperation } from '../serviceCallTasks/execute';
import { executeServiceCallTaskResourceOperation } from '../serviceCallTaskResources/execute';
import { executeServiceOperation } from '../services/execute';
import { executeTicketOperation } from '../tickets/execute';
import { executeTicketNoteOperation } from '../ticketNotes/execute';
import { executeTicketNoteWebhookOperation } from '../ticketNoteWebhooks/execute';
import { executeTicketWebhookOperation } from '../ticketWebhooks/execute';
import { executeTicketHistoryOperation } from '../ticketHistories/execute';
import { executeTimeEntryOperation } from '../timeEntries/execute';
import { executeSurveyOperation } from '../surveys/execute';
import { executeSurveyResultsOperation } from '../surveyResults/execute';
import { executeSkillOperation } from '../skills/execute';

/**
 * Resource executor mapping for dynamic execution
 */
const RESOURCE_EXECUTORS: Record<
string,
(this: IExecuteFunctions) => Promise<INodeExecutionData[][]>
> = {
	aiHelper: executeAiHelperOperation,
	apiThreshold: executeApiThresholdOperation,
	billingCode: executeBillingCodeOperation,
	company: executeCompanyOperation,
	companyAlert: executeCompanyAlertOperation,
	companyNote: executeCompanyNoteOperation,
        companySiteConfigurations: executeCompanySiteConfigurationOperation,
	companyWebhook: executeCompanyWebhookOperation,
	configurationItemWebhook: executeConfigurationItemWebhookOperation,
	configurationItems: executeConfigurationItemOperation,
	configurationItemCategories: executeConfigurationItemCategoryOperation,
	configurationItemCategoryUdfAssociation: executeConfigurationItemCategoryUdfAssociationOperation,
	configurationItemNote: executeConfigurationItemNoteOperation,
	configurationItemTypes: executeConfigurationItemTypeOperation,
	configurationItemRelatedItem: executeConfigurationItemRelatedItemOperation,
	configurationItemDnsRecord: executeConfigurationItemDnsRecordOperation,
	configurationItemBillingProductAssociation: executeConfigurationItemBillingProductAssociationOperation,
	configurationItemSslSubjectAlternativeName: executeConfigurationItemSslSubjectAlternativeNameOperation,
	contact: executeContactOperation,
	contactWebhook: executeContactWebhookOperation,
	contactGroups: executeContactGroupsOperation,
	contactGroupContacts: executeContactGroupContactsOperation,
	companyLocation: executeCompanyLocationOperation,
	contract: executeContractOperation,
	contractBillingRule: executeContractBillingRuleOperation,
	contractCharge: executeContractChargeOperation,
	contractNote: executeContractNoteOperation,
	contractService: executeContractServiceOperation,
	contractServiceAdjustment: executeContractServiceAdjustmentOperation,
	contractServiceBundleAdjustment: executeContractServiceBundleAdjustmentOperation,
	contractServiceBundle: executeContractServiceBundleOperation,
	contractServiceBundleUnit: executeContractServiceBundleUnitOperation,
	contractMilestone: executeContractMilestoneOperation,
	contractServiceUnit: executeContractServiceUnitOperation,
	contractBlock: executeContractBlockOperation,
	contractBlockHourFactor: executeContractBlockHourFactorOperation,
	contractRate: executeContractRateOperation,
	contractRoleCosts: executeContractRoleCostsOperation,
	contractRetainer: executeContractRetainersOperation,
	contractTicketPurchase: executeContractTicketPurchasesOperation,
	contractExclusionBillingCode: executeContractExclusionBillingCodeOperation,
	contractExclusionRoles: executeContractExclusionRoleOperation,
	contractExclusionSets: executeContractExclusionSetsOperation,
	contractExclusionSetExcludedRole: executeContractExclusionSetExcludedRolesOperation,
	contractExclusionSetExcludedWorkType: executeContractExclusionSetExcludedWorkTypesOperation,
	country: executeCountryOperation,
	DomainRegistrar: executeDomainRegistrarOperation,
	holidaySet: executeHolidaySetOperation,
	holiday: executeHolidayOperation,
	invoice: executeInvoiceOperation,
	notificationHistory: executeNotificationHistoryOperation,
	opportunity: executeOpportunityOperation,
	product: executeProductOperation,
	productVendor: executeProductVendorOperation,
	project: executeProjectOperation,
	projectCharge: executeProjectChargeOperation,
	projectNote: executeProjectNoteOperation,
	phase: executeProjectPhaseOperation,
	task: executeProjectTaskOperation,
	quote: executeQuoteOperation,
	quoteItem: executeQuoteItemOperation,
	quoteLocation: executeQuoteLocationOperation,
	quoteTemplate: executeQuoteTemplateOperation,
	resource: executeResourceOperation,
	resourceRole: executeResourceRoleOperation,
	role: executeRoleOperation,
	serviceCall: executeServiceCallOperation,
	serviceCallTicket: executeServiceCallTicketOperation,
	serviceCallTicketResource: executeServiceCallTicketResourceOperation,
	serviceCallTask: executeServiceCallTaskOperation,
	serviceCallTaskResource: executeServiceCallTaskResourceOperation,
	service: executeServiceOperation,
	ticket: executeTicketOperation,
	ticketNote: executeTicketNoteOperation,
	ticketNoteWebhook: executeTicketNoteWebhookOperation,
	ticketWebhook: executeTicketWebhookOperation,
	TicketHistory: executeTicketHistoryOperation,
	timeEntry: executeTimeEntryOperation,
	survey: executeSurveyOperation,
	surveyResults: executeSurveyResultsOperation,
        skill: executeSkillOperation,
};

/**
 * Normalized executor map for case-insensitive lookups
 */
const NORMALIZED_RESOURCE_EXECUTORS: Record<
string,
(this: IExecuteFunctions) => Promise<INodeExecutionData[][]>
> = Object.fromEntries(
        Object.entries(RESOURCE_EXECUTORS).map(([key, value]) => [key.toLowerCase(), value]),
);

/**
 * Execute tool operation by routing to appropriate resource executor
 */
export async function executeToolOperation(
        this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const targetResource = this.getNodeParameter('targetResource', 0) as string;
	const resourceOperation = this.getNodeParameter('resourceOperation', 0) as string;
        const entityId = this.getNodeParameter('entityId', 0, '') as string;
        const fields = this.getNodeParameter('fields', 0, null);
        const filters = this.getNodeParameter('filters', 0, null);
        const fieldsToMapInput = fields ?? filters ?? this.getNodeParameter('fieldsToMap', 0, null);
        const fieldsToMap =
                fieldsToMapInput && typeof fieldsToMapInput === 'object' && !('mappingMode' in fieldsToMapInput)
                        ? { mappingMode: 'defineBelow', value: fieldsToMapInput }
                        : fieldsToMapInput;

	// Validate required parameters
	if (!targetResource) {
		throw new NodeOperationError(
			this.getNode(),
			'Target resource is required for tool operation'
		);
	}

	if (!resourceOperation) {
		throw new NodeOperationError(
			this.getNode(),
			'Resource operation is required for tool operation'
		);
	}

        // Check if target resource executor exists (case-insensitive)
        const normalizedResourceName = targetResource.toLowerCase();
        const executor = NORMALIZED_RESOURCE_EXECUTORS[normalizedResourceName];
        if (!executor) {
                throw new NodeOperationError(
                        this.getNode(),
                        `Resource "${targetResource}" is not supported by the tool`
                );
        }

        // Resolve canonical resource name for downstream parameter overrides
        const canonicalResource = Object.keys(RESOURCE_EXECUTORS).find(
                key => key.toLowerCase() === normalizedResourceName,
        ) ?? targetResource;

	// Store original getNodeParameter method
	const originalGetNodeParameter = this.getNodeParameter;

	// Override getNodeParameter to return resource-specific values
this.getNodeParameter = ((
name: string,
index: number,
fallbackValue?: unknown,
options?: IGetNodeParameterOptions,
): unknown => {
                switch (name) {
                        case 'resource':
                                return canonicalResource;
                        case 'operation':
                                return resourceOperation;
                        case 'id':
                                return entityId;
                        case 'fieldsToMap':
                                return fieldsToMap;
                        default:
                                return originalGetNodeParameter.call(this, name, index, fallbackValue, options);
                }
}) as typeof originalGetNodeParameter;

	try {
		// Route to existing executor with manipulated context
		return await executor.call(this);
        } finally {
                // Always restore original method
                this.getNodeParameter = originalGetNodeParameter;
        }
}
