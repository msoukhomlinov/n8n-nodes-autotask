import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems, compareDedupField } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IOpportunityCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type OpportunityCreateOutcome = 'created' | 'skipped' | 'updated' | 'company_not_found';

export interface IOpportunityCreateResult {
	outcome: OpportunityCreateOutcome;
	companyId?: number;
	opportunityId?: number;
	existingId?: number;
	title?: string;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map for dedup comparison ─────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	title: 'string',
	companyID: 'integer',
	ownerResourceID: 'integer',
	contactID: 'integer',
	amount: 'double',
	probability: 'integer',
	projectedCloseDate: 'datetime',
	startDate: 'datetime',
	closedDate: 'datetime',
};

// ─── Step 0: Verify company exists ───────────────────────────────────────────

async function verifyCompanyExists(
	ctx: IExecuteFunctions,
	companyId: number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Companies/query',
		{ filter: [{ field: 'id', op: 'eq', value: companyId }] },
	);
	const items = extractItems(response as IDataObject);
	return items.length > 0;
}

// ─── Step 1: Find duplicate opportunity ──────────────────────────────────────

async function findDuplicateOpportunity(
	ctx: IExecuteFunctions,
	companyId: number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Always filter server-side by companyID to narrow the result set
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'companyID', op: 'eq', value: companyId },
	];

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Opportunities/query',
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

// ─── Step 2: Create opportunity ───────────────────────────────────────────────

async function createOpportunity(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Opportunities',
		createFields as IDataObject,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const newId = extractId(response as IDataObject);
	if (!newId) {
		throw new Error('Opportunity creation succeeded but returned no ID.');
	}
	return newId;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createOpportunityIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IOpportunityCreateIfNotExistsOptions,
): Promise<IOpportunityCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const rawCompanyID = createFields.companyID as string | number | undefined;
	if (rawCompanyID === undefined || rawCompanyID === null || rawCompanyID === '') {
		throw new Error('createFields.companyID is required for opportunity.createIfNotExists');
	}

	const companyId = Number(rawCompanyID);
	const title = createFields.title as string | undefined;

	// Step 0: Verify company exists
	const companyExists = await verifyCompanyExists(ctx, companyId);
	if (!companyExists) {
		return { outcome: 'company_not_found', companyId, title, warnings };
	}

	// Step 1: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateOpportunity(
		ctx, companyId, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate Opportunity found (ID: ${duplicate.id}) for Company ${companyId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const { patch, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
				duplicate as Record<string, unknown>,
				createFields,
				updateFields,
				FIELD_TYPE_MAP,
			);
			if (skipped.length > 0) {
				diffWarnings.push(
					`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`,
				);
			}
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'Opportunity',
					duplicateId: duplicate.id as number,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					companyId,
					existingId: duplicate.id as number,
					title,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					companyId,
					existingId: duplicate.id as number,
					title,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_opportunity',
			companyId,
			existingId: duplicate.id as number,
			title,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 2: Create opportunity
	const newId = await createOpportunity(
		ctx,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		companyId,
		opportunityId: newId,
		title,
		warnings,
	};
}
