import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskField } from '../types/base/entities';
import { autotaskApiRequest, buildChildEntityUrl } from './http';
import { getFields } from './entity/api';
import { ATTACHMENT_TYPE, MAX_ATTACHMENT_SIZE_BYTES } from './attachment';

export interface IMoveToCompanyOptions {
	sourceContactId: number;
	destinationCompanyId: number;
	destinationCompanyLocationId?: number | null; // null = auto-map by name, number = explicit, undefined = omit
	skipIfDuplicateEmailFound: boolean;
	copyContactGroups: boolean;
	copyCompanyNotes: boolean;
	copyNoteAttachments: boolean;
	sourceAuditNote: string;
	destinationAuditNote: string;
}

export interface IMoveToCompanyResult {
	success: boolean;
	skipped: boolean;
	newContactId: number;
	sourceContactId: number;
	sourceCompanyId: number;
	destinationCompanyId: number;
	contactIdMapping: Record<number, number>;
	companyNoteIdMapping: Record<number, number>;
	contactGroupsCopied: number[];
	auditNotes: { sourceCompanyNoteId: number; destinationCompanyNoteId: number };
	warnings: string[];
}

/** Fields that must never be copied to the new contact */
const EXCLUDED_FIELDS = new Set([
	'id',
	'createDate',
	'lastActivityDate',
	'lastModifiedDate',
]);

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// ─── Step 1: Fetch source contact ───────────────────────────────────────────

async function fetchSourceContact(
	ctx: IExecuteFunctions,
	sourceContactId: number,
): Promise<IDataObject> {
	const endpoint = `Contacts/${sourceContactId}/`;
	const response = await autotaskApiRequest.call(ctx, 'GET', endpoint) as { item: IDataObject };

	if (!response?.item) {
		throw new Error(`Source contact ID ${sourceContactId} not found`);
	}

	const contact = response.item;

	if (contact.isActive === 0 || contact.isActive === false) {
		throw new Error(`Source contact ID ${sourceContactId} is already inactive`);
	}

	return contact;
}

// ─── Step 2: Fetch writable field definitions ───────────────────────────────

async function fetchWritableFieldDefs(
	ctx: IExecuteFunctions,
): Promise<IAutotaskField[]> {
	const fields = await getFields('contact', ctx) as IAutotaskField[];
	return fields.filter(f => !f.isReadOnly && !EXCLUDED_FIELDS.has(f.name));
}

// ─── Step 3: Check for duplicate email at destination ───────────────────────

async function checkDuplicateEmail(
	ctx: IExecuteFunctions,
	emailAddress: string | undefined,
	destinationCompanyId: number,
): Promise<number | null> {
	if (!emailAddress) return null;

	const queryEndpoint = 'Contacts/query/';
	const body = {
		filter: [
			{ field: 'emailAddress', op: 'eq', value: emailAddress },
			{ field: 'companyID', op: 'eq', value: destinationCompanyId },
		],
	};

	const response = await autotaskApiRequest.call(ctx, 'POST', queryEndpoint, body) as { items?: IDataObject[] };

	if (response?.items?.length) {
		const existingIdRaw = response.items[0].id;
		const existingId = typeof existingIdRaw === 'number'
			? existingIdRaw
			: Number.parseInt(String(existingIdRaw), 10);
		if (Number.isInteger(existingId) && existingId > 0) {
			return existingId;
		}
		return -1;
	}

	return null;
}

// ─── Step 4: Build new contact payload ──────────────────────────────────────

function buildNewContactPayload(
	sourceContact: IDataObject,
	writableFields: IAutotaskField[],
	destinationCompanyId: number,
	resolvedDestinationCompanyLocationId: number | undefined,
): IDataObject {
	const payload: IDataObject = { id: 0 };

	const writableFieldNames = new Set(writableFields.map(f => f.name));

	for (const fieldName of writableFieldNames) {
		if (EXCLUDED_FIELDS.has(fieldName)) continue;
		if (sourceContact[fieldName] !== undefined && sourceContact[fieldName] !== null) {
			payload[fieldName] = sourceContact[fieldName];
		}
	}

	// Override company ID
	payload.companyID = destinationCompanyId;

	// Set a destination location only when it is explicitly resolved.
	if (resolvedDestinationCompanyLocationId !== undefined) {
		payload.companyLocationID = resolvedDestinationCompanyLocationId;
	} else {
		delete payload.companyLocationID;
	}

	// Copy UDFs as-is
	if (Array.isArray(sourceContact.userDefinedFields)) {
		payload.userDefinedFields = sourceContact.userDefinedFields;
	}

	return payload;
}

async function getCompanyLocationNameById(
	ctx: IExecuteFunctions,
	companyId: number,
	companyLocationId: number,
): Promise<string | undefined> {
	const endpoint = buildChildEntityUrl('Company', 'CompanyLocation', companyId, { entityId: companyLocationId });
	const response = await autotaskApiRequest.call(ctx, 'GET', endpoint) as { item?: IDataObject };
	const locationName = response?.item?.name;
	if (typeof locationName === 'string' && locationName.trim() !== '') {
		return locationName.trim();
	}
	return undefined;
}

async function resolveDestinationCompanyLocationId(
	ctx: IExecuteFunctions,
	sourceContact: IDataObject,
	sourceCompanyId: number,
	destinationCompanyId: number,
	destinationCompanyLocationId: number | null | undefined,
	warnings: string[],
): Promise<number | undefined> {
	// Omitted in UI: do not set location.
	if (destinationCompanyLocationId === undefined) {
		return undefined;
	}

	// Explicit location ID in UI: use as-is.
	if (destinationCompanyLocationId !== null) {
		return destinationCompanyLocationId;
	}

	// Auto-map by name.
	const sourceLocationIdRaw = sourceContact.companyLocationID;
	if (!isPositiveInteger(sourceLocationIdRaw)) {
		return undefined;
	}

	let sourceLocationName: string | undefined;
	try {
		sourceLocationName = await getCompanyLocationNameById(ctx, sourceCompanyId, sourceLocationIdRaw);
	} catch (err) {
		warnings.push(`Failed to resolve source location ${sourceLocationIdRaw} for auto-mapping: ${(err as Error).message}`);
		return undefined;
	}

	if (!sourceLocationName) {
		warnings.push(`Source location ${sourceLocationIdRaw} has no name; destination location was not set.`);
		return undefined;
	}

	let destinationMatches: IDataObject[] = [];
	try {
		const response = await autotaskApiRequest.call(ctx, 'POST', 'CompanyLocations/query/', {
			filter: [
				{ field: 'companyID', op: 'eq', value: destinationCompanyId },
				{ field: 'name', op: 'eq', value: sourceLocationName },
			],
		}) as { items?: IDataObject[] };
		destinationMatches = response?.items ?? [];
	} catch (err) {
		warnings.push(`Failed to query destination locations for auto-mapping: ${(err as Error).message}`);
		return undefined;
	}

	if (!destinationMatches.length) {
		warnings.push(`No destination location named "${sourceLocationName}" was found on company ${destinationCompanyId}; destination location was not set.`);
		return undefined;
	}

	const mappedLocationIdRaw = destinationMatches[0].id;
	const mappedLocationId = typeof mappedLocationIdRaw === 'number'
		? mappedLocationIdRaw
		: Number.parseInt(String(mappedLocationIdRaw), 10);

	if (!isPositiveInteger(mappedLocationId)) {
		warnings.push(`Destination location match "${sourceLocationName}" returned an invalid ID; destination location was not set.`);
		return undefined;
	}

	if (destinationMatches.length > 1) {
		warnings.push(`Multiple destination locations matched "${sourceLocationName}". Using location ID ${mappedLocationId}.`);
	}

	return mappedLocationId;
}

// ─── Step 5: Create destination contact ─────────────────────────────────────

async function createDestinationContact(
	ctx: IExecuteFunctions,
	destinationCompanyId: number,
	payload: IDataObject,
): Promise<number> {
	const endpoint = buildChildEntityUrl('Company', 'Contact', destinationCompanyId);
	const response = await autotaskApiRequest.call(ctx, 'POST', endpoint, payload) as { itemId?: number };

	if (!response?.itemId) {
		throw new Error('Failed to create contact at destination company: no itemId returned');
	}

	return response.itemId;
}

// ─── Step 6: Copy contact group memberships ─────────────────────────────────

async function copyContactGroupMemberships(
	ctx: IExecuteFunctions,
	sourceContactId: number,
	newContactId: number,
	warnings: string[],
): Promise<number[]> {
	const copiedGroups: number[] = [];

	// Query ContactGroupContacts for source contact
	const queryEndpoint = 'ContactGroupContacts/query/';
	const body = {
		filter: [{ field: 'contactID', op: 'eq', value: sourceContactId }],
	};

	let response: { items?: IDataObject[] };
	try {
		response = await autotaskApiRequest.call(ctx, 'POST', queryEndpoint, body) as { items?: IDataObject[] };
	} catch (err) {
		warnings.push(`Failed to query contact group memberships: ${(err as Error).message}`);
		return copiedGroups;
	}

	if (!response?.items?.length) return copiedGroups;

	for (const membership of response.items) {
		const groupId = membership.contactGroupID as number;
		try {
			await autotaskApiRequest.call(ctx, 'POST', 'ContactGroupContacts/', {
				contactID: newContactId,
				contactGroupID: groupId,
			});
			copiedGroups.push(groupId);
		} catch (err) {
			warnings.push(`Failed to copy contact group ${groupId}: ${(err as Error).message}`);
		}
	}

	return copiedGroups;
}

// ─── Step 7: Copy company notes and attachments ─────────────────────────────

async function copyCompanyNotesAndAttachments(
	ctx: IExecuteFunctions,
	sourceContactId: number,
	sourceCompanyId: number,
	newContactId: number,
	destinationCompanyId: number,
	copyAttachments: boolean,
	warnings: string[],
): Promise<Record<number, number>> {
	const noteIdMapping: Record<number, number> = {};

	// Query CompanyNotes linked to the source contact
	const queryEndpoint = 'CompanyNotes/query/';
	const body = {
		filter: [{ field: 'contactID', op: 'eq', value: sourceContactId }],
	};

	let response: { items?: IDataObject[] };
	try {
		response = await autotaskApiRequest.call(ctx, 'POST', queryEndpoint, body) as { items?: IDataObject[] };
	} catch (err) {
		warnings.push(`Failed to query company notes: ${(err as Error).message}`);
		return noteIdMapping;
	}

	if (!response?.items?.length) return noteIdMapping;

	for (const note of response.items) {
		const sourceNoteId = note.id as number;
		try {
			// Build new note payload
			const newNote: IDataObject = { ...note };
			delete newNote.id;
			newNote.companyID = destinationCompanyId;
			newNote.contactID = newContactId;
			// Remove read-only fields
			delete newNote.createDateTime;
			delete newNote.lastModifiedDateTime;
			delete newNote.creatorResourceID;
			delete newNote.impersonatorCreatorResourceID;

			const endpoint = buildChildEntityUrl('Company', 'CompanyNote', destinationCompanyId);
			const createResponse = await autotaskApiRequest.call(ctx, 'POST', endpoint, newNote) as { itemId?: number };

			if (createResponse?.itemId) {
				noteIdMapping[sourceNoteId] = createResponse.itemId;

				// Copy attachments if enabled
				if (copyAttachments) {
					await copyNoteAttachments(
						ctx, sourceCompanyId, sourceNoteId,
						destinationCompanyId, createResponse.itemId,
						warnings,
					);
				}
			} else {
				warnings.push(`Created note from source note ${sourceNoteId} but no ID was returned`);
			}
		} catch (err) {
			warnings.push(`Failed to copy company note ${sourceNoteId}: ${(err as Error).message}`);
		}
	}

	return noteIdMapping;
}

async function copyNoteAttachments(
	ctx: IExecuteFunctions,
	sourceCompanyId: number,
	sourceNoteId: number,
	destinationCompanyId: number,
	newNoteId: number,
	warnings: string[],
): Promise<void> {
	// List attachments on the source note via the parent-chain URL
	// CompanyNoteAttachment: parentChain ['Company','CompanyNote'], subname 'Attachment'
	const listEndpoint = `Companies/${sourceCompanyId}/Notes/${sourceNoteId}/Attachments/`;

	let response: { items?: IDataObject[] };
	try {
		response = await autotaskApiRequest.call(ctx, 'GET', listEndpoint) as { items?: IDataObject[] };
	} catch (err) {
		warnings.push(`Failed to list attachments for note ${sourceNoteId}: ${(err as Error).message}`);
		return;
	}

	if (!response?.items?.length) return;

	for (const attachment of response.items) {
		const attachmentId = attachment.id as number;
		try {
			// Download attachment data via parent-chain URL
			const downloadEndpoint = `Companies/${sourceCompanyId}/Notes/${sourceNoteId}/Attachments/${attachmentId}/`;
			const dataResponse = await autotaskApiRequest.call(ctx, 'GET', downloadEndpoint) as { items?: IDataObject[] };

			const attachmentData = dataResponse?.items?.[0];
			if (!attachmentData?.data) {
				warnings.push(`Attachment ${attachmentId} on note ${sourceNoteId} has no data, skipping`);
				continue;
			}

			const base64Data = attachmentData.data as string;
			const dataSize = Buffer.from(base64Data, 'base64').length;

			if (dataSize > MAX_ATTACHMENT_SIZE_BYTES) {
				warnings.push(`Attachment ${attachmentId} on note ${sourceNoteId} exceeds 6MB (${Math.round(dataSize / 1024 / 1024)}MB), skipping`);
				continue;
			}

			// Create attachment on new note via parent-chain URL
			const createEndpoint = `Companies/${destinationCompanyId}/Notes/${newNoteId}/Attachments/`;
			await autotaskApiRequest.call(ctx, 'POST', createEndpoint, {
				id: 0,
				parentID: newNoteId,
				attachmentType: ATTACHMENT_TYPE,
				data: base64Data,
				fullPath: attachmentData.fullPath || attachmentData.title || 'attachment',
				title: attachmentData.title || 'attachment',
				publish: attachmentData.publish ?? 1,
			});
		} catch (err) {
			warnings.push(`Failed to copy attachment ${attachmentId} from note ${sourceNoteId}: ${(err as Error).message}`);
		}
	}
}

// ─── Step 8: Create audit notes ─────────────────────────────────────────────

function resolveTemplate(
	template: string,
	vars: Record<string, string | number>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
	}
	return result;
}

async function createAuditNotes(
	ctx: IExecuteFunctions,
	options: IMoveToCompanyOptions,
	sourceContact: IDataObject,
	sourceCompanyId: number,
	newContactId: number,
	warnings: string[],
): Promise<{ sourceCompanyNoteId: number; destinationCompanyNoteId: number }> {
	const contactName = `${sourceContact.firstName || ''} ${sourceContact.lastName || ''}`.trim() || 'Unknown';
	const templateVars = {
		contactName,
		sourceContactId: options.sourceContactId,
		sourceCompanyId,
		destinationCompanyId: options.destinationCompanyId,
		newContactId,
		date: new Date().toISOString().split('T')[0],
	};

	let sourceCompanyNoteId = 0;
	let destinationCompanyNoteId = 0;

	// Source audit note
	if (options.sourceAuditNote) {
		try {
			const noteText = resolveTemplate(options.sourceAuditNote, templateVars);
			const endpoint = buildChildEntityUrl('Company', 'CompanyNote', sourceCompanyId);
			const response = await autotaskApiRequest.call(ctx, 'POST', endpoint, {
				companyID: sourceCompanyId,
				contactID: options.sourceContactId,
				title: 'Contact Moved',
				description: noteText,
				actionType: 1, // General note
				publish: 1,
			}) as { itemId?: number };
			sourceCompanyNoteId = response?.itemId || 0;
		} catch (err) {
			warnings.push(`Failed to create source audit note: ${(err as Error).message}`);
		}
	}

	// Destination audit note
	if (options.destinationAuditNote) {
		try {
			const noteText = resolveTemplate(options.destinationAuditNote, templateVars);
			const endpoint = buildChildEntityUrl('Company', 'CompanyNote', options.destinationCompanyId);
			const response = await autotaskApiRequest.call(ctx, 'POST', endpoint, {
				companyID: options.destinationCompanyId,
				contactID: newContactId,
				title: 'Contact Moved',
				description: noteText,
				actionType: 1,
				publish: 1,
			}) as { itemId?: number };
			destinationCompanyNoteId = response?.itemId || 0;
		} catch (err) {
			warnings.push(`Failed to create destination audit note: ${(err as Error).message}`);
		}
	}

	return { sourceCompanyNoteId, destinationCompanyNoteId };
}

// ─── Step 9: Deactivate source contact ──────────────────────────────────────

async function deactivateSourceContact(
	ctx: IExecuteFunctions,
	sourceContactId: number,
	sourceCompanyId: number,
	sourceContact: IDataObject,
	warnings: string[],
): Promise<void> {
	// Warn if primary contact
	if (sourceContact.isPrimaryContact === true || sourceContact.isPrimaryContact === 1) {
		warnings.push(`Source contact ${sourceContactId} is the primary contact for company ${sourceCompanyId}. It has been deactivated but you may need to assign a new primary contact.`);
	}

	try {
		const patchEndpoint = buildChildEntityUrl('Company', 'Contact', sourceCompanyId);
		await autotaskApiRequest.call(ctx, 'PATCH', patchEndpoint, {
			id: sourceContactId,
			isActive: 0,
		});
	} catch (err) {
		warnings.push(`Failed to deactivate source contact ${sourceContactId}: ${(err as Error).message}. The new contact was created successfully.`);
	}
}

// ─── Main orchestration ─────────────────────────────────────────────────────

export async function moveContactToCompany(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IMoveToCompanyOptions,
): Promise<IMoveToCompanyResult> {
	const warnings: string[] = [];

	// Step 1: Fetch source contact (critical)
	const sourceContact = await fetchSourceContact(ctx, options.sourceContactId);
	const sourceCompanyId = sourceContact.companyID as number;

	if (sourceCompanyId === options.destinationCompanyId) {
		throw new Error('Source and destination company are the same. No move needed.');
	}

	// Step 2: Fetch writable field definitions (critical)
	const writableFields = await fetchWritableFieldDefs(ctx);

	// Step 3: Check for duplicate email (critical)
	const duplicateDestinationContactId = await checkDuplicateEmail(
		ctx,
		sourceContact.emailAddress as string | undefined,
		options.destinationCompanyId,
	);
	if (duplicateDestinationContactId !== null) {
		const duplicateMessage = duplicateDestinationContactId > 0
			? `A contact with email "${String(sourceContact.emailAddress)}" already exists at destination company ${options.destinationCompanyId} (Contact ID: ${duplicateDestinationContactId}).`
			: `A contact with email "${String(sourceContact.emailAddress)}" already exists at destination company ${options.destinationCompanyId}.`;

		if (!options.skipIfDuplicateEmailFound) {
			throw new Error(`${duplicateMessage} Aborting to prevent duplicates.`);
		}

		warnings.push(`${duplicateMessage} Skipped move because "Skip If Duplicate Email Found" is enabled. No changes were made.`);
		return {
			success: true,
			skipped: true,
			newContactId: duplicateDestinationContactId > 0 ? duplicateDestinationContactId : 0,
			sourceContactId: options.sourceContactId,
			sourceCompanyId,
			destinationCompanyId: options.destinationCompanyId,
			contactIdMapping: duplicateDestinationContactId > 0
				? { [options.sourceContactId]: duplicateDestinationContactId }
				: {},
			companyNoteIdMapping: {},
			contactGroupsCopied: [],
			auditNotes: { sourceCompanyNoteId: 0, destinationCompanyNoteId: 0 },
			warnings,
		};
	}

	// Step 4: Resolve destination company location (critical)
	const resolvedDestinationCompanyLocationId = await resolveDestinationCompanyLocationId(
		ctx,
		sourceContact,
		sourceCompanyId,
		options.destinationCompanyId,
		options.destinationCompanyLocationId,
		warnings,
	);

	// Step 5: Build new contact payload (critical)
	const payload = buildNewContactPayload(
		sourceContact, writableFields,
		options.destinationCompanyId, resolvedDestinationCompanyLocationId,
	);

	// Step 6: Create destination contact (critical)
	const newContactId = await createDestinationContact(ctx, options.destinationCompanyId, payload);

	// Step 7: Copy contact group memberships (optional)
	let contactGroupsCopied: number[] = [];
	if (options.copyContactGroups) {
		contactGroupsCopied = await copyContactGroupMemberships(ctx, options.sourceContactId, newContactId, warnings);
	}

	// Step 8: Copy company notes and attachments (optional)
	let companyNoteIdMapping: Record<number, number> = {};
	if (options.copyCompanyNotes) {
		companyNoteIdMapping = await copyCompanyNotesAndAttachments(
			ctx, options.sourceContactId, sourceCompanyId,
			newContactId, options.destinationCompanyId,
			options.copyNoteAttachments, warnings,
		);
	}

	// Step 9: Create audit notes (optional)
	const auditNotes = await createAuditNotes(ctx, options, sourceContact, sourceCompanyId, newContactId, warnings);

	// Step 10: Deactivate source contact (optional)
	await deactivateSourceContact(ctx, options.sourceContactId, sourceCompanyId, sourceContact, warnings);

	return {
		success: true,
		skipped: false,
		newContactId,
		sourceContactId: options.sourceContactId,
		sourceCompanyId,
		destinationCompanyId: options.destinationCompanyId,
		contactIdMapping: { [options.sourceContactId]: newContactId },
		companyNoteIdMapping,
		contactGroupsCopied,
		auditNotes,
		warnings,
	};
}
