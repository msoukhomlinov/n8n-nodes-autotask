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
import { executeCompanyLocationOperation } from './resources/companyLocations/execute';
import { executeResourceOperation } from './resources/resources/execute';
import { executeCompanyNoteOperation } from './resources/companyNotes/execute';
import { executeCompanyWebhookOperation } from './resources/companyWebhooks/execute';
import { executeConfigurationItemWebhookOperation } from './resources/configurationItemWebhooks/execute';
import { executeTicketNoteWebhookOperation } from './resources/ticketNoteWebhooks/execute';
import { executeProjectNoteOperation } from './resources/projectNotes/execute';
import { executeProjectPhaseOperation } from './resources/projectPhases/execute';
import { executeProjectChargeOperation } from './resources/projectCharges/execute';
import { executeProductOperation } from './resources/products/execute';
import { executeTicketOperation } from './resources/tickets/execute';
import { executeTicketNoteOperation } from './resources/ticketNotes/execute';
import { executeTicketHistoryOperation } from './resources/ticketHistories/execute';
import { executeTimeEntryOperation } from './resources/timeEntries/execute';
import { executeBillingCodeOperation } from './resources/billingCodes/execute';
import { executeHolidaySetOperation } from './resources/holidaySets/execute';
import { executeHolidayOperation } from './resources/holidays/execute';
import { executeServiceCallOperation } from './resources/serviceCalls/execute';
import { executeServiceOperation } from './resources/services/execute';
import { executeContractOperation } from './resources/contracts/execute';
import { executeContractChargeOperation } from './resources/contractCharges/execute';
import { executeContractNoteOperation } from './resources/contractNotes/execute';
import { executeContractServiceOperation } from './resources/contractServices/execute';
import { executeContractMilestoneOperation } from './resources/contractMilestones/execute';
import { executeContractServiceUnitOperation } from './resources/contractServiceUnits/execute';
import { executeContractBlockOperation } from './resources/contractBlocks/execute';
import { executeContractBlockHourFactorOperation } from './resources/contractBlockHourFactors/execute';
import { executeContractRateOperation } from './resources/contractRates/execute';
import { executeOpportunityOperation } from './resources/opportunities/execute';
import { searchFilterDescription, searchFilterOperations, build as executeSearchFilterOperation } from './resources/searchFilter';
import { getResourceMapperFields } from './helpers/resourceMapper';
import { RESOURCE_DEFINITIONS } from './resources/definitions';
import { projectTaskFields } from './resources/projectTasks/description';
import { projectFields } from './resources/projects/description';
import { companyFields } from './resources/companies/description';
import { companyAlertFields } from './resources/companyAlerts/description';
import { contactFields } from './resources/contacts/description';
import { companyLocationFields } from './resources/companyLocations/description';
import { resourceFields } from './resources/resources/description';
import { companyNoteFields } from './resources/companyNotes/description';
import { projectNoteFields } from './resources/projectNotes/description';
import { projectPhaseFields } from './resources/projectPhases/description';
import { projectChargeFields } from './resources/projectCharges/description';
import { productFields } from './resources/products/description';
import { ticketFields } from './resources/tickets/description';
import { ticketHistoryFields } from './resources/ticketHistories/description';
import { ticketNoteFields } from './resources/ticketNotes/description';
import { timeEntryFields } from './resources/timeEntries/description';
import { billingCodeFields } from './resources/billingCodes/description';
import { holidaySetFields } from './resources/holidaySets/description';
import { holidayFields } from './resources/holidays/description';
import { serviceCallFields } from './resources/serviceCalls/description';
import { serviceFields } from './resources/services/description';
import { contractFields } from './resources/contracts/description';
import { contractChargeFields } from './resources/contractCharges/description';
import { contractNoteFields } from './resources/contractNotes/description';
import { contractServiceFields } from './resources/contractServices/description';
import { contractMilestoneFields } from './resources/contractMilestones/description';
import { contractServiceUnitFields } from './resources/contractServiceUnits/description';
import { contractBlockFields } from './resources/contractBlocks/description';
import { contractBlockHourFactorFields } from './resources/contractBlockHourFactors/description';
import { contractRateFields } from './resources/contractRates/description';
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
		description: 'Consume Autotask REST API',
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
				default: 'company',
			},
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
			...addOperationsToResource(companyLocationFields, { resourceName: 'companyLocation' }),
			...addOperationsToResource(contractFields, { resourceName: 'contract' }),
			...addOperationsToResource(contractChargeFields, { resourceName: 'contractCharge' }),
			...addOperationsToResource(contractNoteFields, { resourceName: 'contractNote' }),
			...addOperationsToResource(contractServiceFields, { resourceName: 'contractService' }),
			...addOperationsToResource(contractMilestoneFields, { resourceName: 'contractMilestone' }),
			...addOperationsToResource(contractServiceUnitFields, { resourceName: 'contractServiceUnit' }),
			...addOperationsToResource(contractBlockFields, { resourceName: 'contractBlock' }),
			...addOperationsToResource(contractBlockHourFactorFields, { resourceName: 'contractBlockHourFactor' }),
			...addOperationsToResource(contractRateFields, { resourceName: 'contractRate' }),
			...addOperationsToResource(holidaySetFields, { resourceName: 'holidaySet' }),
			...addOperationsToResource(holidayFields, { resourceName: 'holiday' }),
			...addOperationsToResource(opportunityFields, { resourceName: 'opportunity' }),
			...addOperationsToResource(productFields, { resourceName: 'product' }),
			...addOperationsToResource(projectFields, { resourceName: 'project' }),
			...addOperationsToResource(projectChargeFields, { resourceName: 'projectCharge' }),
			...addOperationsToResource(projectNoteFields, { resourceName: 'projectNote' }),
			...addOperationsToResource(projectPhaseFields, { resourceName: 'phase' }),
			...addOperationsToResource(projectTaskFields, { resourceName: 'task' }),
			...addOperationsToResource(resourceFields, { resourceName: 'resource' }),
			...addOperationsToResource(serviceCallFields, { resourceName: 'serviceCall' }),
			...addOperationsToResource(serviceFields, { resourceName: 'service' }),
			...addOperationsToResource(ticketFields, { resourceName: 'ticket' }),
			...addOperationsToResource(ticketNoteFields, { resourceName: 'ticketNote' }),
			...addOperationsToResource(ticketNoteWebhookFields, { resourceName: 'ticketNoteWebhook' }),
			...addOperationsToResource(ticketHistoryFields, { resourceName: 'TicketHistory' }),
			...addOperationsToResource(timeEntryFields, { resourceName: 'timeEntry' }),
			...addOperationsToResource(billingCodeFields, { resourceName: 'billingCode' }),
			...addOperationsToResource(surveyFields, { resourceName: 'survey' }),
			...addOperationsToResource(surveyResultsFields, { resourceName: 'surveyResults' }),
			// searchFilterDescription and searchFilterOperations should not have common operations added to them
			...searchFilterDescription,
			...searchFilterOperations,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const resource = this.getNodeParameter('resource', 0) as string;

		// Handle resource-specific operations
		switch (resource) {
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
			case 'companyLocation':
				return executeCompanyLocationOperation.call(this);
			case 'contract':
				return executeContractOperation.call(this);
			case 'contractCharge':
				return executeContractChargeOperation.call(this);
			case 'contractNote':
				return executeContractNoteOperation.call(this);
			case 'contractService':
				return executeContractServiceOperation.call(this);
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
			case 'holidaySet':
				return executeHolidaySetOperation.call(this);
			case 'holiday':
				return executeHolidayOperation.call(this);
			case 'opportunity':
				return executeOpportunityOperation.call(this);
			case 'product':
				return executeProductOperation.call(this);
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
			case 'resource':
				return executeResourceOperation.call(this);
			case 'searchFilter':
				return executeSearchFilterOperation.call(this);
			case 'serviceCall':
				return executeServiceCallOperation.call(this);
			case 'service':
				return executeServiceOperation.call(this);
			case 'ticket':
				return executeTicketOperation.call(this);
			case 'ticketNote':
				return executeTicketNoteOperation.call(this);
			case 'TicketHistory':
				return executeTicketHistoryOperation.call(this);
			case 'timeEntry':
				return executeTimeEntryOperation.call(this);
			case 'survey':
				return executeSurveyOperation.call(this);
			case 'surveyResults':
				return executeSurveyResultsOperation.call(this);
			case 'ticketNoteWebhook':
				return executeTicketNoteWebhookOperation.call(this);
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

				try {
					// Get fields using the same function that powers the resource mapper
					const { fields } = await getResourceMapperFields.call(this, resource);

					// Format fields for multiOptions
					return fields.map(field => ({
						name: field.displayName || field.id,
						value: field.id,
					}));
				} catch (error) {
					console.error(`Error loading select columns options: ${error.message}`);
					return [];
				}
			},
		},
	};
}
