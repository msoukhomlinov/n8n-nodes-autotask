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
	/** Field in the result containing the entity's numeric ID (all outcomes: created/skipped/updated). */
	entityIdField: string;
	/** Helper-only fields present in createFields that are never written to the API as-is and must be
	 *  excluded from the record{} echo (e.g. materialCode is resolved to billingCodeID by the helper). */
	recordExcludeFields?: string[];
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
		recordExcludeFields: ['materialCode'],
	},
	ticketCharge: {
		getHandler: () =>
			import('../helpers/ticket-charge-creator').then(
				(m) => m.createTicketChargeIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['name', 'datePurchased'],
		entityIdField: 'chargeId',
		recordExcludeFields: ['materialCode'],
	},
	projectCharge: {
		getHandler: () =>
			import('../helpers/project-charge-creator').then(
				(m) => m.createProjectChargeIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['name', 'datePurchased'],
		entityIdField: 'chargeId',
		recordExcludeFields: ['materialCode'],

	},
	configurationItems: {
		getHandler: () =>
			import('../helpers/configuration-item-creator').then(
				(m) => m.createConfigurationItemIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['serialNumber'],
		entityIdField: 'configurationItemId',

	},
	timeEntry: {
		getHandler: () =>
			import('../helpers/time-entry-creator').then(
				(m) => m.createTimeEntryIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['dateWorked', 'hoursWorked'],
		entityIdField: 'timeEntryId',
	},
	contractService: {
		getHandler: () =>
			import('../helpers/contract-service-creator').then(
				(m) => m.createContractServiceIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['serviceID'],
		entityIdField: 'contractServiceId',

	},
	contract: {
		getHandler: () =>
			import('../helpers/contract-creator').then(
				(m) => m.createContractIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['contractName'],
		entityIdField: 'contractId',

	},
	opportunity: {
		getHandler: () =>
			import('../helpers/opportunity-creator').then(
				(m) => m.createOpportunityIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['title'],
		entityIdField: 'opportunityId',

	},
	expenseItem: {
		getHandler: () =>
			import('../helpers/expense-item-creator').then(
				(m) => m.createExpenseItemIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['expenseDate', 'description'],
		entityIdField: 'expenseItemId',
	},
	ticketAdditionalConfigurationItem: {
		getHandler: () =>
			import('../helpers/ticket-additional-ci-creator').then(
				(m) => m.createTicketAdditionalCIIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['configurationItemID'],
		entityIdField: 'ticketAdditionalConfigurationItemId',

	},
	ticketAdditionalContact: {
		getHandler: () =>
			import('../helpers/ticket-additional-contact-creator').then(
				(m) => m.createTicketAdditionalContactIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['contactID'],
		entityIdField: 'ticketAdditionalContactId',

	},
	changeRequestLink: {
		getHandler: () =>
			import('../helpers/change-request-link-creator').then(
				(m) => m.createChangeRequestLinkIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['changeRequestTicketID', 'problemOrIncidentTicketID'],
		entityIdField: 'linkId',
	},
	holidaySet: {
		getHandler: () =>
			import('../helpers/holiday-set-creator').then(
				(m) => m.createHolidaySetIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['holidaySetName'],
		entityIdField: 'holidaySetId',
	},
	holiday: {
		getHandler: () =>
			import('../helpers/holiday-creator').then(
				(m) => m.createHolidayIfNotExists as CompoundOperationHandler,
			),
		defaultDedupFields: ['holidayDate'],
		entityIdField: 'holidayId',
	},
};

