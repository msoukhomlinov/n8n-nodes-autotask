import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';
import { findDuplicate } from './entity-dedup';
import { buildApiCreateBody } from './udf/split';

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
	title?: string;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: Record<string, { from: unknown; to: unknown }>;
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

function findDuplicateOpportunity(
	ctx: IExecuteFunctions,
	companyId: number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	return findDuplicate(ctx, {
		entityType: 'Opportunity',
		queryEndpoint: 'Opportunities/query',
		scopeFilters: [{ field: 'companyID', op: 'eq', value: companyId }],
		dedupFields,
		createFields,
		fieldTypeMap: FIELD_TYPE_MAP,
	});
}

// ─── Step 2: Create opportunity ───────────────────────────────────────────────

async function createOpportunity(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body = await buildApiCreateBody(ctx, 'Opportunity', createFields);
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Opportunities',
		body,
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
		return { outcome: 'company_not_found', companyId, title, reason: `Company with ID ${companyId} not found.`, warnings };
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
			const { patch, fieldChanges, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
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
					opportunityId: duplicate.id as number,
					title,
					matchedDedupFields: matchedFields,
					fieldsUpdated: fieldChanges,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					companyId,
					opportunityId: duplicate.id as number,
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
			opportunityId: duplicate.id as number,
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
