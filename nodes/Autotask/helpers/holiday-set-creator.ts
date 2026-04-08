import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IHolidaySetCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type HolidaySetCreateOutcome = 'created' | 'skipped' | 'updated';

export interface IHolidaySetCreateResult {
	outcome: HolidaySetCreateOutcome;
	holidaySetId?: number;
	existingHolidaySetId?: number;
	holidaySetName?: string;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map ───────────────────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	holidaySetName: 'string',
	holidaySetDescription: 'string',
};

// ─── Step 1: Find duplicate holiday set ──────────────────────────────────────

async function findDuplicateHolidaySet(
	ctx: IExecuteFunctions,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Server-side: filter by the first dedup field if present
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [];
	const firstDedupField = dedupFields[0];
	if (firstDedupField && createFields[firstDedupField] !== undefined) {
		apiFilter.push({
			field: firstDedupField,
			op: 'eq',
			value: createFields[firstDedupField],
		});
	}

	if (apiFilter.length === 0) {
		console.warn(`[holidaySetCreator] Dedup fields [${dedupFields.join(', ')}] configured but no matching values in createFields — skipping dedup check`);
		return { duplicate: null, matchedFields: [] };
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'HolidaySets/query',
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

// ─── Step 2: Create holiday set ───────────────────────────────────────────────

async function createHolidaySet(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'HolidaySets',
		createFields as IDataObject,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const id = extractId(response as IDataObject);
	if (!id) {
		throw new Error('HolidaySet creation succeeded but returned no ID.');
	}
	return id;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createHolidaySetIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IHolidaySetCreateIfNotExistsOptions,
): Promise<IHolidaySetCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const holidaySetName = createFields.holidaySetName as string | undefined;

	// Step 1: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateHolidaySet(
		ctx, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate HolidaySet found (ID: ${duplicate.id}, name: "${duplicate.holidaySetName}"). ` +
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
				diffWarnings.push(`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`);
			}
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'HolidaySet',
					duplicateId: duplicate.id as number,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					existingHolidaySetId: duplicate.id as number,
					holidaySetName: duplicate.holidaySetName as string,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					existingHolidaySetId: duplicate.id as number,
					holidaySetName: duplicate.holidaySetName as string,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_holiday_set',
			existingHolidaySetId: duplicate.id as number,
			holidaySetName: duplicate.holidaySetName as string,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 2: Create holiday set
	const holidaySetId = await createHolidaySet(
		ctx,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		holidaySetId,
		holidaySetName,
		warnings,
	};
}
