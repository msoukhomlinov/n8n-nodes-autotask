import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IHolidayCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type HolidayCreateOutcome = 'created' | 'skipped' | 'updated' | 'holiday_set_not_found';

export interface IHolidayCreateResult {
	outcome: HolidayCreateOutcome;
	holidaySetId?: number;
	holidayId?: number;
	existingHolidayId?: number;
	holidayDate?: string;
	holidayName?: string;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map ───────────────────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	holidayDate: 'date',
	holidayName: 'string',
	holidaySetID: 'integer',
};

// ─── Step 0: Verify holiday set exists ───────────────────────────────────────

async function verifyHolidaySetExists(
	ctx: IExecuteFunctions,
	holidaySetId: number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'HolidaySets/query',
		{ filter: [{ field: 'id', op: 'eq', value: holidaySetId }] },
	);
	return extractItems(response as IDataObject).length > 0;
}

// ─── Step 1: Find duplicate holiday ──────────────────────────────────────────

async function findDuplicateHoliday(
	ctx: IExecuteFunctions,
	holidaySetId: number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Always scope by holidaySetID; add first dedup field as server-side filter when available
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'holidaySetID', op: 'eq', value: holidaySetId },
	];

	const firstDedupField = dedupFields[0];
	if (firstDedupField && firstDedupField !== 'holidaySetID' && createFields[firstDedupField] !== undefined) {
		apiFilter.push({
			field: firstDedupField,
			op: 'eq',
			value: createFields[firstDedupField],
		});
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'Holidays/query', { filter: apiFilter },
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

// ─── Step 2: Create holiday ───────────────────────────────────────────────────

async function createHoliday(
	ctx: IExecuteFunctions,
	holidaySetId: number,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body: IDataObject = { ...createFields as IDataObject };

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		`HolidaySets/${holidaySetId}/Holidays`,
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const id = extractId(response as IDataObject);
	if (!id) {
		throw new Error('Holiday creation succeeded but returned no ID.');
	}
	return id;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createHolidayIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IHolidayCreateIfNotExistsOptions,
): Promise<IHolidayCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const rawHolidaySetID = createFields.holidaySetID as string | number | undefined;
	if (rawHolidaySetID === undefined || rawHolidaySetID === null || rawHolidaySetID === '') {
		throw new Error('createFields.holidaySetID is required for holiday.createIfNotExists');
	}

	const holidaySetId = Number(rawHolidaySetID);
	const holidayDate = createFields.holidayDate as string | undefined;
	const holidayName = createFields.holidayName as string | undefined;

	// Step 0: Verify holiday set exists
	const setExists = await verifyHolidaySetExists(ctx, holidaySetId);
	if (!setExists) {
		return {
			outcome: 'holiday_set_not_found',
			holidaySetId,
			reason: `HolidaySet with ID ${holidaySetId} not found.`,
			warnings,
		};
	}

	// Step 1: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateHoliday(
		ctx, holidaySetId, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate Holiday found (ID: ${duplicate.id}) in HolidaySet ${holidaySetId}. ` +
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
					resource: 'Holiday',
					duplicateId: duplicate.id as number,
					parentId: holidaySetId,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					holidaySetId,
					existingHolidayId: duplicate.id as number,
					holidayDate,
					holidayName,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					holidaySetId,
					existingHolidayId: duplicate.id as number,
					holidayDate,
					holidayName,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_holiday',
			holidaySetId,
			existingHolidayId: duplicate.id as number,
			holidayDate,
			holidayName,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 2: Create holiday
	const holidayId = await createHoliday(
		ctx,
		holidaySetId,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		holidaySetId,
		holidayId,
		holidayDate,
		holidayName,
		warnings,
	};
}
