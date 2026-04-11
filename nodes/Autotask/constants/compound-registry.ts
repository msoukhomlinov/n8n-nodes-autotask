import type { IExecuteFunctions } from 'n8n-workflow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompoundOperationOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	updateFields?: string[];
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompoundOperationHandler = (ctx: IExecuteFunctions, itemIndex: number, options: CompoundOperationOptions) => Promise<any>;

export interface CompoundRegistryEntry {
	/** Lazy importer that returns the handler function (Node.js caches after first call). */
	getHandler: () => Promise<CompoundOperationHandler>;
	/** Default dedup fields when the caller does not specify dedupFields. */
	defaultDedupFields: string[];
	/** Field in the result containing the created entity's numeric ID. */
	entityIdField: string;
	/** Field in the result containing the existing entity's numeric ID (on skip/update). */
	existingIdField: string;
	/**
	 * Outcome string that indicates the parent entity was not found.
	 * When the compound result's `outcome` matches this, the tool returns
	 * an ENTITY_NOT_FOUND error for the parent rather than the created entity.
	 */
	notFoundOutcome?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Single source of truth for all createIfNotExists compound operations.
 *
 * To add a new compound op:
 * 1. Create the helper file in `helpers/`
 * 2. Add an entry here
 */
export const COMPOUND_REGISTRY: Record<string, CompoundRegistryEntry> = {
	contractCharge: {
		getHandler: () =>
			import('../helpers/contract-charge-creator').then(
				(m) => m.createContractChargeIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['name', 'datePurchased'],
		entityIdField: 'chargeId',
		existingIdField: 'existingChargeId',
		notFoundOutcome: 'contract_not_found',
	},
	ticketCharge: {
		getHandler: () =>
			import('../helpers/ticket-charge-creator').then(
				(m) => m.createTicketChargeIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['name', 'datePurchased'],
		entityIdField: 'chargeId',
		existingIdField: 'existingChargeId',
		notFoundOutcome: 'ticket_not_found',
	},
	projectCharge: {
		getHandler: () =>
			import('../helpers/project-charge-creator').then(
				(m) => m.createProjectChargeIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['name', 'datePurchased'],
		entityIdField: 'chargeId',
		existingIdField: 'existingChargeId',
		notFoundOutcome: 'project_not_found',
	},
	configurationItems: {
		getHandler: () =>
			import('../helpers/configuration-item-creator').then(
				(m) => m.createConfigurationItemIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['serialNumber'],
		entityIdField: 'configurationItemId',
		existingIdField: 'existingConfigurationItemId',
		notFoundOutcome: 'company_not_found',
	},
	timeEntry: {
		getHandler: () =>
			import('../helpers/time-entry-creator').then(
				(m) => m.createTimeEntryIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['dateWorked', 'hoursWorked'],
		entityIdField: 'timeEntryId',
		existingIdField: 'existingTimeEntryId',
	},
	contractService: {
		getHandler: () =>
			import('../helpers/contract-service-creator').then(
				(m) => m.createContractServiceIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['serviceID'],
		entityIdField: 'contractServiceId',
		existingIdField: 'existingContractServiceId',
		notFoundOutcome: 'contract_not_found',
	},
	contract: {
		getHandler: () =>
			import('../helpers/contract-creator').then(
				(m) => m.createContractIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['contractName'],
		entityIdField: 'contractId',
		existingIdField: 'existingContractId',
		notFoundOutcome: 'company_not_found',
	},
	opportunity: {
		getHandler: () =>
			import('../helpers/opportunity-creator').then(
				(m) => m.createOpportunityIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['title'],
		entityIdField: 'opportunityId',
		existingIdField: 'existingId',
		notFoundOutcome: 'company_not_found',
	},
	expenseItem: {
		getHandler: () =>
			import('../helpers/expense-item-creator').then(
				(m) => m.createExpenseItemIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['expenseDate', 'description'],
		entityIdField: 'expenseItemId',
		existingIdField: 'existingExpenseItemId',
	},
	ticketAdditionalConfigurationItem: {
		getHandler: () =>
			import('../helpers/ticket-additional-ci-creator').then(
				(m) => m.createTicketAdditionalCIIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['configurationItemID'],
		entityIdField: 'ticketAdditionalConfigurationItemId',
		existingIdField: 'existingId',
		notFoundOutcome: 'ticket_not_found',
	},
	ticketAdditionalContact: {
		getHandler: () =>
			import('../helpers/ticket-additional-contact-creator').then(
				(m) => m.createTicketAdditionalContactIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['contactID'],
		entityIdField: 'ticketAdditionalContactId',
		existingIdField: 'existingId',
		notFoundOutcome: 'ticket_not_found',
	},
	changeRequestLink: {
		getHandler: () =>
			import('../helpers/change-request-link-creator').then(
				(m) => m.createChangeRequestLinkIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['changeRequestTicketID', 'problemOrIncidentTicketID'],
		entityIdField: 'linkId',
		existingIdField: 'existingLinkId',
	},
	holidaySet: {
		getHandler: () =>
			import('../helpers/holiday-set-creator').then(
				(m) => m.createHolidaySetIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['holidaySetName'],
		entityIdField: 'holidaySetId',
		existingIdField: 'existingHolidaySetId',
	},
	holiday: {
		getHandler: () =>
			import('../helpers/holiday-creator').then(
				(m) => m.createHolidayIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['holidayDate'],
		entityIdField: 'holidayId',
		existingIdField: 'existingHolidayId',
		notFoundOutcome: 'holiday_set_not_found',
	},
};

/**
 * Set of all outcome strings that mean a parent entity was not found.
 * Derived from the registry — no manual maintenance needed.
 */
export const COMPOUND_PARENT_NOT_FOUND_OUTCOMES: ReadonlySet<string> = new Set([
	'parent_not_found', // defensive — kept for forward-compatibility
	...Object.values(COMPOUND_REGISTRY)
		.map((e) => e.notFoundOutcome)
		.filter((v): v is string => v !== undefined),
]);
