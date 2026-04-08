import type { IExecuteFunctions } from 'n8n-workflow';
import {
	createChargeIfNotExists,
	type IChargeCreateIfNotExistsOptions,
	type ChargeCreatorConfig,
	type IChargeCreateResult,
} from './charge-creator-base';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type ITicketChargeCreateIfNotExistsOptions = IChargeCreateIfNotExistsOptions;

export type TicketChargeCreateIfNotExistsOutcome = 'created' | 'skipped' | 'updated' | 'ticket_not_found';

export interface ITicketChargeCreateIfNotExistsResult {
	outcome: TicketChargeCreateIfNotExistsOutcome;
	ticketId?: number;
	chargeId?: number;
	existingChargeId?: number;
	ticketID: string | number;
	chargeName: string;
	datePurchased: string;
	unitQuantity?: number;
	unitPrice?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

const TICKET_CHARGE_CONFIG_BY_ID: ChargeCreatorConfig = {
	parentEntityLabel: 'Ticket',
	parentQueryEndpoint: 'Tickets/query',
	parentLookupField: 'id',
	chargeQueryEndpoint: 'TicketCharges/query',
	chargeParentIdField: 'ticketID',
	chargeCreateEndpointTemplate: 'Tickets/{parentId}/Charges',
	entityName: 'TicketCharge',
	fieldTypeMap: {
		name: 'string',
		datePurchased: 'datetime',
		unitQuantity: 'double',
		unitCost: 'double',
		unitPrice: 'double',
	},
};

const TICKET_CHARGE_CONFIG_BY_TICKET_NUMBER: ChargeCreatorConfig = {
	...TICKET_CHARGE_CONFIG_BY_ID,
	parentLookupField: 'ticketNumber',
};

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createTicketChargeIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: ITicketChargeCreateIfNotExistsOptions,
): Promise<ITicketChargeCreateIfNotExistsResult> {
	const ticketID = options.createFields.ticketID as string | number | undefined;
	if (ticketID === undefined || ticketID === null || ticketID === '') {
		throw new Error('ticketID is required in createFields to find the ticket.');
	}

	// Determine lookup strategy:
	// - Numeric value → look up by id field
	// - String containing non-digit characters → look up by ticketNumber
	// - String of only digits → treat as numeric ID
	const isNumericId = typeof ticketID === 'number' || (typeof ticketID === 'string' && /^\d+$/.test(ticketID) && parseInt(ticketID, 10) > 0);

	const config = isNumericId
		? TICKET_CHARGE_CONFIG_BY_ID
		: TICKET_CHARGE_CONFIG_BY_TICKET_NUMBER;

	const lookupValue = String(ticketID);

	const result = await createChargeIfNotExists(
		ctx,
		config,
		lookupValue,
		options,
	);

	return mapToTicketChargeResult(result, ticketID);
}

// ─── Result mapper ────────────────────────────────────────────────────────────

function mapToTicketChargeResult(
	result: IChargeCreateResult,
	ticketID: string | number,
): ITicketChargeCreateIfNotExistsResult {
	const outcome = result.outcome === 'parent_not_found'
		? 'ticket_not_found' as const
		: result.outcome;

	return {
		outcome,
		ticketId: result.parentId,
		chargeId: result.chargeId,
		existingChargeId: result.existingChargeId,
		ticketID,
		chargeName: result.chargeName,
		datePurchased: result.datePurchased,
		unitQuantity: result.unitQuantity,
		unitPrice: result.unitPrice,
		reason: result.reason,
		matchedDedupFields: result.matchedDedupFields,
		fieldsUpdated: result.fieldsUpdated,
		fieldsCompared: result.fieldsCompared,
		warnings: result.warnings,
	};
}
