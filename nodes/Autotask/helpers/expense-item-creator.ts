import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';
import { findDuplicate } from './entity-dedup';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IExpenseItemCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ExpenseItemCreateOutcome = 'created' | 'skipped' | 'updated';

export interface IExpenseItemCreateResult {
	outcome: ExpenseItemCreateOutcome;
	expenseReportID: string | number;
	expenseItemId?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: Record<string, { from: unknown; to: unknown }>;
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map ──────────────────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	expenseDate: 'datetime',
	expenseCurrencyExpenseAmount: 'double',
	internalCurrencyExpenseAmount: 'double',
	miles: 'double',
	odometerStart: 'double',
	odometerEnd: 'double',
	description: 'string',
	expenseReportID: 'integer',
	companyID: 'integer',
	projectID: 'integer',
	taskID: 'integer',
	ticketID: 'integer',
	expenseCategory: 'integer',
	paymentType: 'integer',
	workType: 'integer',
};

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createExpenseItemIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IExpenseItemCreateIfNotExistsOptions,
): Promise<IExpenseItemCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const expenseReportID = createFields.expenseReportID as string | number | undefined;
	if (expenseReportID === undefined || expenseReportID === null) {
		throw new Error('createFields.expenseReportID is required for expenseItem.createIfNotExists');
	}

	// Step 1: Find duplicate using central dedup logic (handles standard + UDF fields)
	const { duplicate: entry, matchedFields: matched } = await findDuplicate(ctx, {
		entityType: 'ExpenseItem',
		queryEndpoint: 'ExpenseItems/query',
		scopeFilters: [{ field: 'expenseReportID', op: 'eq', value: expenseReportID }],
		dedupFields,
		createFields,
		fieldTypeMap: FIELD_TYPE_MAP,
	});

	if (entry) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate expense item found (ID: ${entry.id}) for expenseReportID ${expenseReportID}. ` +
				`Matched dedup fields: ${matched.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const { patch, fieldChanges, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
				entry as Record<string, unknown>,
				createFields,
				updateFields,
				FIELD_TYPE_MAP,
			);
			if (skipped.length > 0) {
				diffWarnings.push(`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`);
			}
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'ExpenseItem',
					duplicateId: entry.id as number,
					parentId: Number(expenseReportID),
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					expenseReportID,
					expenseItemId: entry.id as number,
					matchedDedupFields: matched,
					fieldsUpdated: fieldChanges,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					expenseReportID,
					expenseItemId: entry.id as number,
					matchedDedupFields: matched,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			expenseReportID,
			expenseItemId: entry.id as number,
			reason: 'duplicate_expense_item',
			matchedDedupFields: matched,
			warnings,
		};
	}

	// Step 4: Create via child endpoint — POST to /Expenses/{expenseReportID}/Items
	const body: IDataObject = {
		...createFields as IDataObject,
	};

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		`Expenses/${expenseReportID}/Items`,
		body,
		{},
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied ?? true,
	);

	const expenseItemId = extractId(response as IDataObject);
	if (!expenseItemId) {
		throw new Error('Expense item creation succeeded but returned no ID.');
	}

	// Step 5: Return created result
	return {
		outcome: 'created',
		expenseReportID,
		expenseItemId,
		warnings,
	};
}
