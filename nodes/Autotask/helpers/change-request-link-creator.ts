import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';

export interface IChangeRequestLinkCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}

export type ChangeRequestLinkCreateOutcome = 'created' | 'skipped';

export interface IChangeRequestLinkCreateResult {
	outcome: ChangeRequestLinkCreateOutcome;
	changeRequestTicketID?: string | number;
	problemOrIncidentTicketID?: string | number;
	linkId?: number;
	existingLinkId?: number;
	reason?: string;
	matchedDedupFields?: string[];
	warnings: string[];
}

const FIELD_TYPE_MAP: Record<string, string> = {
	changeRequestTicketID: 'integer',
	problemOrIncidentTicketID: 'integer',
};

async function findDuplicateLink(
	ctx: IExecuteFunctions,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [];

	if (dedupFields.includes('changeRequestTicketID') && createFields.changeRequestTicketID !== undefined) {
		apiFilter.push({ field: 'changeRequestTicketID', op: 'eq', value: createFields.changeRequestTicketID });
	}
	if (dedupFields.includes('problemOrIncidentTicketID') && createFields.problemOrIncidentTicketID !== undefined) {
		apiFilter.push({ field: 'problemOrIncidentTicketID', op: 'eq', value: createFields.problemOrIncidentTicketID });
	}

	if (apiFilter.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'ChangeRequestLinks/query', { filter: apiFilter },
	);

	const items = extractItems(response as IDataObject);

	for (const item of items) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = FIELD_TYPE_MAP[field] ?? 'integer';
			const inputValue = createFields[field];
			const apiValue = item[field];

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

async function createLink(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'ChangeRequestLinks',
		createFields as IDataObject, {},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const linkId = extractId(response as IDataObject);
	if (!linkId) {
		throw new Error('ChangeRequestLink creation succeeded but returned no ID.');
	}
	return linkId;
}

export async function createChangeRequestLinkIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IChangeRequestLinkCreateIfNotExistsOptions,
): Promise<IChangeRequestLinkCreateResult> {
	const { createFields, dedupFields, errorOnDuplicate } = options;
	const warnings: string[] = [];

	const changeRequestTicketID = createFields.changeRequestTicketID as string | number | undefined;
	const problemOrIncidentTicketID = createFields.problemOrIncidentTicketID as string | number | undefined;

	if (changeRequestTicketID === undefined || changeRequestTicketID === null) {
		throw new Error('createFields.changeRequestTicketID is required for changeRequestLink.createIfNotExists');
	}
	if (problemOrIncidentTicketID === undefined || problemOrIncidentTicketID === null) {
		throw new Error('createFields.problemOrIncidentTicketID is required for changeRequestLink.createIfNotExists');
	}

	const { duplicate, matchedFields } = await findDuplicateLink(ctx, dedupFields, createFields);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate ChangeRequestLink found (ID: ${duplicate.id}) for changeRequestTicketID=${changeRequestTicketID}, ` +
				`problemOrIncidentTicketID=${problemOrIncidentTicketID}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}
		return {
			outcome: 'skipped',
			changeRequestTicketID,
			problemOrIncidentTicketID,
			existingLinkId: duplicate.id as number,
			reason: 'duplicate_link',
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	const linkId = await createLink(
		ctx, createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		changeRequestTicketID,
		problemOrIncidentTicketID,
		linkId,
		warnings,
	};
}
