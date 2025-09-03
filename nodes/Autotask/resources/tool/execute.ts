import type { IExecuteFunctions, INodeExecutionData, IGetNodeParameterOptions, IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { validateParameters } from '../../helpers/aiHelper';
import { createDryRunResponse } from '../../helpers/dry-run';
import { buildEntityUrl } from '../../helpers/http/request';

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
	configurationItemBillingProductAssociation:
		executeConfigurationItemBillingProductAssociationOperation,
	configurationItemSslSubjectAlternativeName:
		executeConfigurationItemSslSubjectAlternativeNameOperation,
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
 * AI-First design with comprehensive string-based validation
 */
export async function executeToolOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	// Get AI-friendly parameters
	const targetOperation = this.getNodeParameter('targetOperation', 0, '') as string;
	const entityId = this.getNodeParameter('entityId', 0, '') as string;
	const requestDataJson = this.getNodeParameter('requestData', 0, '{}') as string;

	// Validate and parse targetOperation
	const parsed = targetOperation.split('.');
	if (parsed.length !== 2 || !parsed[0] || !parsed[1]) {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid targetOperation format. Expected "resource.operation" but got "${targetOperation}".\n\n` +
			`Examples:\n` +
			`• ticket.create - Create a new ticket\n` +
			`• company.getMany - Get multiple companies\n` +
			`• contact.update - Update a contact\n\n` +
			`Use aiHelper.listCapabilities() to see all available combinations.`,
		);
	}

	const [targetResource, resourceOperation] = parsed;

	// Parse and validate request data JSON
	let requestData: Record<string, unknown> = {};
	if (requestDataJson && requestDataJson !== '{}') {
		try {
			requestData = JSON.parse(requestDataJson);
			if (typeof requestData !== 'object' || requestData === null || Array.isArray(requestData)) {
				throw new Error('Request data must be a JSON object');
			}
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				`Invalid requestData JSON format: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
				`Expected a JSON object like:\n` +
				`• Create: {"title": "New Ticket", "priority": "High"}\n` +
				`• Update: {"title": "Updated Title", "status": "Complete"}\n` +
				`• Filters: {"filter": [{"field": "status", "op": "eq", "value": "Open"}]}\n\n` +
				`Use aiHelper.describeResource("${targetResource}", "write") for field requirements.`,
			);
		}
	}

	// Validate resource exists
	const normalizedResourceName = targetResource.toLowerCase();
	const executor = NORMALIZED_RESOURCE_EXECUTORS[normalizedResourceName];
	if (!executor) {
		const availableResources = Object.keys(RESOURCE_EXECUTORS).slice(0, 10).join(', ');
		throw new NodeOperationError(
			this.getNode(),
			`Resource "${targetResource}" is not supported.\n\n` +
			`Available resources include: ${availableResources}...\n\n` +
			`Use aiHelper.listCapabilities() to see all available resources and operations.`,
		);
	}

	// Resolve canonical resource name for downstream compatibility
	const canonicalResource =
		Object.keys(RESOURCE_EXECUTORS).find((key) => key.toLowerCase() === normalizedResourceName) ??
		targetResource;

	// Apply safety gates with improved error messages
	await applySafetyGates.call(this, targetResource, resourceOperation);

	// If this is a delete dry-run, return a preview without invoking resource executors
	const isDryRun = this.getNodeParameter('dryRun', 0, false) as boolean;
	if (resourceOperation === 'delete' && isDryRun) {
		if (!entityId) {
			throw new NodeOperationError(
				this.getNode(),
				'Entity ID is required for delete operations (even in dry-run).',
			);
		}

		const endpoint = buildEntityUrl(canonicalResource, { entityId });
		const preview = await createDryRunResponse(
			this,
			canonicalResource,
			'delete',
			{ method: 'DELETE', url: endpoint },
		);
		return [[{ json: preview as unknown as IDataObject }]];
	}

	// Validate request data for write operations
	if (['create', 'update'].includes(resourceOperation)) {
		await validateToolRequestData.call(this, targetResource, resourceOperation, entityId, requestData);
	}

	// Validate entity ID for operations that require it
	if (['get', 'update', 'delete'].includes(resourceOperation) && !entityId) {
		throw new NodeOperationError(
			this.getNode(),
			`Entity ID is required for ${resourceOperation} operations.\n\n` +
			`Example: For "ticket.update", provide the ticket ID like "12345".`,
		);
	}

	// Store original getNodeParameter method
	const originalGetNodeParameter = this.getNodeParameter;

	// Override getNodeParameter to map tool parameters to what existing executors expect
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
			// Map requestData to the format existing executors expect
			case 'fields':
			case 'filters':
				if (Object.keys(requestData).length > 0) {
					// Convert to resource mapper format for compatibility
					return {
						mappingMode: 'defineBelow',
						value: requestData,
					};
				}
				return fallbackValue;
			// Forward other parameters as-is
			case 'selectColumns':
			case 'selectColumnsJson':
				return originalGetNodeParameter.call(this, 'selectColumns', index, fallbackValue, options);

			case 'dryRun':
				return originalGetNodeParameter.call(this, 'dryRun', index, fallbackValue, options);
			default:
				return originalGetNodeParameter.call(this, name, index, fallbackValue, options);
		}
	}) as typeof originalGetNodeParameter;

	try {
		// Route to existing executor with mapped parameters
		return await executor.call(this);
	} finally {
		// Always restore original method
		this.getNodeParameter = originalGetNodeParameter;
	}
}

/**
 * Validate request data for create/update operations using aiHelper
 */
async function validateToolRequestData(
	this: IExecuteFunctions,
	targetResource: string,
	resourceOperation: string,
	entityId: string,
	requestData: Record<string, unknown>,
): Promise<void> {
	try {
		// For update operations, include the entity ID in validation
		const fieldValues = { ...requestData };
		if (resourceOperation === 'update' && entityId) {
			fieldValues.id = entityId;
		}

		// Skip validation if no field values provided
		if (Object.keys(fieldValues).length === 0) {
			return;
		}

		// Determine validation mode
		const mode = resourceOperation === 'create' ? 'create' : 'update';

		// Validate using aiHelper
		const validation = await validateParameters(this, targetResource, mode, fieldValues);

		// If validation fails, provide detailed error information
		if (!validation.isValid) {
			const errorMessages = validation.errors.map((err) => `${err.field}: ${err.message}`);
			const warningMessages = validation.warnings.map((warn) => `${warn.field}: ${warn.message}`);

			let errorMessage = `Request data validation failed for ${targetResource}.${resourceOperation}:\n\n`;
			errorMessage += `Errors:\n${errorMessages.map(msg => `• ${msg}`).join('\n')}`;

			if (warningMessages.length > 0) {
				errorMessage += `\n\nWarnings:\n${warningMessages.map(msg => `• ${msg}`).join('\n')}`;
			}

			errorMessage += `\n\nFor help:\n`;
			errorMessage += `• Use aiHelper.describeResource("${targetResource}", "write") to see field requirements\n`;
			errorMessage += `• Use aiHelper.validateParameters("${targetResource}", "${mode}", requestData) for detailed validation\n`;
			errorMessage += `• Use aiHelper.listPicklistValues("${targetResource}", "fieldName") for valid picklist options`;

			throw new NodeOperationError(this.getNode(), errorMessage);
		}

		// Log warnings if any (but don't fail the operation)
		if (validation.warnings.length > 0) {
			console.warn(
				`[tool.validateRequestData] Validation warnings for ${targetResource}.${resourceOperation}:`,
				validation.warnings.map((w) => `${w.field}: ${w.message}`).join(', '),
			);
		}
	} catch (error) {
		// If it's already a NodeOperationError, re-throw it
		if (error instanceof NodeOperationError) {
			throw error;
		}

		// For other validation errors, wrap with helpful context
		const errorMessage =
			`Request data validation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
			`For help:\n` +
			`• Use aiHelper.describeResource("${targetResource}", "write") to see field requirements\n` +
			`• Use aiHelper.validateParameters("${targetResource}", "${resourceOperation === 'create' ? 'create' : 'update'}", requestData) for detailed validation`;

		throw new NodeOperationError(this.getNode(), errorMessage);
	}
}

/**
 * Apply safety gates to restrict operations based on configuration
 */
async function applySafetyGates(
	this: IExecuteFunctions,
	targetResource: string,
	resourceOperation: string,
): Promise<void> {
	try {
		// Get safety gate parameters
		const allowWriteOperations = this.getNodeParameter('allowWriteOperations', 0, false) as boolean;
		const allowDryRunForWrites = this.getNodeParameter('allowDryRunForWrites', 0, true) as boolean;
		const allowedResourcesJson = this.getNodeParameter('allowedResources', 0, '[]') as string;

		// Check if dry run is enabled
		const isDryRun = this.getNodeParameter('dryRun', 0, false) as boolean;

		// Parse allowed resources list
		let allowedResources: string[] = [];
		try {
			allowedResources = JSON.parse(allowedResourcesJson);
			if (!Array.isArray(allowedResources)) {
				allowedResources = [];
			}
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				`Invalid allowedResources format. Must be a JSON array of strings.\n\n` +
				`Example: ["ticket", "company", "contact"]\n\n` +
				`Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}

		// Check resource allow-list
		if (allowedResources.length > 0) {
			const normalizedTargetResource = targetResource.toLowerCase();
			const isAllowed = allowedResources.some(
				(allowed) => allowed.toLowerCase() === normalizedTargetResource,
			);

			if (!isAllowed) {
				throw new NodeOperationError(
					this.getNode(),
					`Resource "${targetResource}" is not in the allowed resources list.\n\n` +
					`Allowed resources: ${allowedResources.join(', ')}\n\n` +
					`To fix:\n` +
					`• Add "${targetResource}" to the allowedResources JSON array\n` +
					`• Or set allowedResources to [] to allow all resources`,
				);
			}
		}

		// Check write operation restrictions
		const isWriteOperation = ['create', 'update', 'delete'].includes(resourceOperation);

		if (isWriteOperation && !allowWriteOperations) {
			if (isDryRun && allowDryRunForWrites) {
				// Allow dry run for validation/preview purposes
				console.warn(
					`[tool.safety] Write operation "${targetResource}.${resourceOperation}" blocked but dry-run allowed for validation`,
				);
				return;
			} else {
				throw new NodeOperationError(
					this.getNode(),
					`Write operations are disabled for safety.\n\n` +
					`Operation "${targetResource}.${resourceOperation}" is not permitted.\n\n` +
					`To fix:\n` +
					`• Enable "Allow Write Operations" to permit write operations\n` +
					`• Or set dryRun to true for validation without execution`,
				);
			}
		}
	} catch (error) {
		if (error instanceof NodeOperationError) {
			throw error;
		}

		throw new NodeOperationError(
			this.getNode(),
			`Safety gate validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

