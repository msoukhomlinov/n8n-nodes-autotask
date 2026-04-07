import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems, compareDedupField } from './dedup-utils';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ITicketAdditionalCICreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}

export type TicketAdditionalCICreateOutcome = 'created' | 'skipped' | 'ticket_not_found';

export interface ITicketAdditionalCICreateResult {
	outcome: TicketAdditionalCICreateOutcome;
	ticketId?: number;
	ticketAdditionalConfigurationItemId?: number;
	existingId?: number;
	configurationItemID?: number;
	reason?: string;
	matchedDedupFields?: string[];
	warnings: string[];
}

// ─── Field type map for dedup comparison ─────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	configurationItemID: 'integer',
};

// ─── Step 0: Verify ticket exists ────────────────────────────────────────────

async function verifyTicketExists(
	ctx: IExecuteFunctions,
	ticketId: number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Tickets/query',
		{ filter: [{ field: 'id', op: 'eq', value: ticketId }] },
	);
	const tickets = extractItems(response as IDataObject);
	return tickets.length > 0;
}

// ─── Step 1: Find duplicate association ──────────────────────────────────────

async function findDuplicateAssociation(
	ctx: IExecuteFunctions,
	ticketId: number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Always filter by ticketID; add configurationItemID server-side when in dedupFields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'ticketID', op: 'eq', value: ticketId },
	];

	if (dedupFields.includes('configurationItemID') && createFields.configurationItemID !== undefined) {
		apiFilter.push({ field: 'configurationItemID', op: 'eq', value: createFields.configurationItemID });
	}

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'TicketAdditionalConfigurationItems/query',
		{ filter: apiFilter },
	);

	const items = extractItems(response as IDataObject);

	for (const item of items) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const inputValue = createFields[field];
			const apiValue = item[field];
			const fieldType = FIELD_TYPE_MAP[field] ?? 'string';

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			return { duplicate: item, matchedFields: matched };
		}
	}

	return { duplicate: null, matchedFields: [] };
}

// ─── Step 2: Create association ───────────────────────────────────────────────

async function createAssociation(
	ctx: IExecuteFunctions,
	ticketId: number,
	configurationItemID: number,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body: IDataObject = { configurationItemID };

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		`Tickets/${ticketId}/AdditionalConfigurationItems`,
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const newId = extractId(response as IDataObject);
	if (!newId) {
		throw new Error('TicketAdditionalConfigurationItem creation succeeded but returned no ID.');
	}
	return newId;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createTicketAdditionalCIIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: ITicketAdditionalCICreateIfNotExistsOptions,
): Promise<ITicketAdditionalCICreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const rawTicketID = createFields.ticketID as string | number | undefined;
	if (rawTicketID === undefined || rawTicketID === null || rawTicketID === '') {
		throw new Error('createFields.ticketID is required for ticketAdditionalConfigurationItem.createIfNotExists');
	}

	const ticketId = Number(rawTicketID);
	const configurationItemID = createFields.configurationItemID as number | undefined;

	// Step 0: Verify ticket exists
	const ticketExists = await verifyTicketExists(ctx, ticketId);
	if (!ticketExists) {
		return { outcome: 'ticket_not_found', ticketId, configurationItemID, warnings };
	}

	// Step 1: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateAssociation(
		ctx, ticketId, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate TicketAdditionalConfigurationItem found (ID: ${duplicate.id}) on Ticket ${ticketId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}
		return {
			outcome: 'skipped',
			reason: 'duplicate_association',
			ticketId,
			existingId: duplicate.id as number,
			configurationItemID,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 2: Create association
	if (configurationItemID === undefined || configurationItemID === null) {
		throw new Error('createFields.configurationItemID is required to create the association.');
	}

	const newId = await createAssociation(
		ctx,
		ticketId,
		configurationItemID,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		ticketId,
		ticketAdditionalConfigurationItemId: newId,
		configurationItemID,
		warnings,
	};
}
