import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ITimeEntryCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type TimeEntryCreateOutcome = 'created' | 'skipped' | 'updated';

export interface ITimeEntryCreateResult {
	outcome: TimeEntryCreateOutcome;
	resourceID: string | number;
	ticketID?: number;
	taskID?: number;
	timeEntryId?: number;
	existingTimeEntryId?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map ──────────────────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
	dateWorked: 'datetime',
	hoursWorked: 'double',
	summaryNotes: 'string',
};

function getFieldType(field: string): string {
	return FIELD_TYPE_MAP[field] ?? 'string';
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createTimeEntryIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: ITimeEntryCreateIfNotExistsOptions,
): Promise<ITimeEntryCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const resourceID = createFields.resourceID as string | number | undefined;
	if (resourceID === undefined || resourceID === null) {
		throw new Error('createFields.resourceID is required for timeEntry.createIfNotExists');
	}

	const ticketID = createFields.ticketID as number | undefined;
	const taskID = createFields.taskID as number | undefined;

	// Step 1: Build dedup query filters
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'resourceID', op: 'eq', value: resourceID },
	];

	if (ticketID !== undefined) {
		apiFilter.push({ field: 'ticketID', op: 'eq', value: ticketID });
	}

	if (taskID !== undefined) {
		apiFilter.push({ field: 'taskID', op: 'eq', value: taskID });
	}

	// Add the first dedup field as a server-side filter for narrowing
	if (dedupFields.length > 0) {
		const firstField = dedupFields[0];
		const inputValue = createFields[firstField];
		if (inputValue !== undefined && inputValue !== null) {
			apiFilter.push({ field: firstField, op: 'eq', value: inputValue });
		}
	}

	// Step 2: Query existing time entries
	let existingEntries: IDataObject[] = [];

	if (dedupFields.length > 0) {
		const response = await autotaskApiRequest.call(
			ctx, 'POST', 'TimeEntries/query', { filter: apiFilter },
		);
		existingEntries = extractItems(response as IDataObject);
	}

	// Step 3: Client-side match all dedupFields
	for (const entry of existingEntries) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = getFieldType(field);
			const inputValue = createFields[field];
			const apiValue = entry[field];

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			// Duplicate found
			if (errorOnDuplicate) {
				throw new Error(
					`Duplicate time entry found (ID: ${entry.id}) for resourceID ${resourceID}. ` +
					`Matched dedup fields: ${matched.join(', ')}. ` +
					`Set errorOnDuplicate=false to skip instead of error.`,
				);
			}

			const { updateFields } = options;
			if (updateFields && updateFields.length > 0) {
				const { patch, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
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
						resource: 'TimeEntry',
						duplicateId: entry.id as number,
						patch,
						impersonationResourceId: options.impersonationResourceId,
						proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
					});
					return {
						outcome: 'updated',
						resourceID,
						ticketID,
						taskID,
						existingTimeEntryId: entry.id as number,
						matchedDedupFields: matched,
						fieldsUpdated: Object.keys(patch),
						fieldsCompared: compared,
						warnings: [...warnings, ...diffWarnings, ...updateWarnings],
					};
				} else {
					return {
						outcome: 'skipped',
						reason: 'duplicate_no_changes',
						resourceID,
						ticketID,
						taskID,
						existingTimeEntryId: entry.id as number,
						matchedDedupFields: matched,
						fieldsCompared: compared,
						warnings: [...warnings, ...diffWarnings],
					};
				}
			}

			return {
				outcome: 'skipped',
				resourceID,
				ticketID,
				taskID,
				existingTimeEntryId: entry.id as number,
				reason: 'duplicate_time_entry',
				matchedDedupFields: matched,
				warnings,
			};
		}
	}

	// Step 4: Build create body and POST
	const body: IDataObject = {
		...createFields as IDataObject,
	};

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'TimeEntries',
		body,
		{},
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied ?? true,
	);

	const timeEntryId = extractId(response as IDataObject);
	if (!timeEntryId) {
		throw new Error('Time entry creation succeeded but returned no ID.');
	}

	// Step 5: Return created result
	return {
		outcome: 'created',
		resourceID,
		ticketID,
		taskID,
		timeEntryId,
		warnings,
	};
}
