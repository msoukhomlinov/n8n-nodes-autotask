import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems, compareDedupField } from './dedup-utils';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ITicketAdditionalContactCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type TicketAdditionalContactCreateOutcome = 'created' | 'skipped' | 'updated' | 'ticket_not_found';

export interface ITicketAdditionalContactCreateResult {
	outcome: TicketAdditionalContactCreateOutcome;
	ticketId?: number;
	ticketAdditionalContactId?: number;
	existingId?: number;
	contactID?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map for dedup comparison ─────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	contactID: 'integer',
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

	// Always filter by ticketID; add contactID server-side when in dedupFields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'ticketID', op: 'eq', value: ticketId },
	];

	if (dedupFields.includes('contactID') && createFields.contactID !== undefined) {
		apiFilter.push({ field: 'contactID', op: 'eq', value: createFields.contactID });
	}

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'TicketAdditionalContacts/query',
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
	contactID: number,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body: IDataObject = { contactID };

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		`Tickets/${ticketId}/AdditionalContacts`,
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const newId = extractId(response as IDataObject);
	if (!newId) {
		throw new Error('TicketAdditionalContact creation succeeded but returned no ID.');
	}
	return newId;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createTicketAdditionalContactIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: ITicketAdditionalContactCreateIfNotExistsOptions,
): Promise<ITicketAdditionalContactCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const rawTicketID = createFields.ticketID as string | number | undefined;
	if (rawTicketID === undefined || rawTicketID === null || rawTicketID === '') {
		throw new Error('createFields.ticketID is required for ticketAdditionalContact.createIfNotExists');
	}

	const ticketId = Number(rawTicketID);
	const contactID = createFields.contactID as number | undefined;

	// Step 0: Verify ticket exists
	const ticketExists = await verifyTicketExists(ctx, ticketId);
	if (!ticketExists) {
		return { outcome: 'ticket_not_found', ticketId, contactID, warnings };
	}

	// Step 1: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateAssociation(
		ctx, ticketId, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate TicketAdditionalContact found (ID: ${duplicate.id}) on Ticket ${ticketId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const { computeFieldDiffs, applyDuplicateUpdate } = await import('./update-fields-on-duplicate');
			const { patch, compared, skipped: _skipped, warnings: diffWarnings } = computeFieldDiffs(
				duplicate as Record<string, unknown>,
				createFields,
				updateFields,
				FIELD_TYPE_MAP,
			);
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'TicketAdditionalContact',
					duplicateId: duplicate.id as number,
					parentId: ticketId,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					ticketId,
					existingId: duplicate.id as number,
					contactID,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					ticketId,
					existingId: duplicate.id as number,
					contactID,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_association',
			ticketId,
			existingId: duplicate.id as number,
			contactID,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 2: Create association
	if (contactID === undefined || contactID === null) {
		throw new Error('createFields.contactID is required to create the association.');
	}

	const newId = await createAssociation(
		ctx,
		ticketId,
		contactID,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		ticketId,
		ticketAdditionalContactId: newId,
		contactID,
		warnings,
	};
}
