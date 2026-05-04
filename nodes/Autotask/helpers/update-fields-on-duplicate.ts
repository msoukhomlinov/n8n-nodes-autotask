import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { compareDedupField, getEntityFieldValue } from './dedup-utils';
import { performPatch } from './entity-writer';

// ─── computeFieldDiffs ────────────────────────────────────────────────────────

export interface IFieldDiffResult {
	/** Fields that differ between the duplicate and desired values (API values to PATCH) */
	patch: Record<string, unknown>;
	/** Per-field from/to values for all fields that differed */
	fieldChanges: Record<string, { from: unknown; to: unknown }>;
	/** Fields that were compared (includes both matching and differing fields) */
	compared: string[];
	/** Fields in updateFields not present in desiredFields — skipped without comparison */
	skipped: string[];
	/** Non-fatal warnings about the comparison process */
	warnings: string[];
}

/**
 * Compare the duplicate row from the API against the desired (input) field values
 * and return only the fields that differ.
 *
 * @param duplicateRow   - The existing record returned by the API
 * @param desiredFields  - The caller's intended field values (e.g. from createFields);
 *                         null values are treated as deliberate field clears and will appear in the patch.
 * @param updateFields   - The subset of field names to compare and potentially patch
 * @param fieldTypeMap   - Maps field name → data type for type-aware comparison
 */
export function computeFieldDiffs(
	duplicateRow: Record<string, unknown>,
	desiredFields: Record<string, unknown>,
	updateFields: string[],
	fieldTypeMap: Record<string, string>,
): IFieldDiffResult {
	const patch: Record<string, unknown> = {};
	const fieldChanges: Record<string, { from: unknown; to: unknown }> = {};
	const compared: string[] = [];
	const skipped: string[] = [];
	const warnings: string[] = [];

	for (const field of updateFields) {
		// If the caller didn't supply a desired value for this field, skip it
		if (!(field in desiredFields)) {
			skipped.push(field);
			continue;
		}

		const fieldType = fieldTypeMap[field] ?? 'string';
		const apiValue = getEntityFieldValue(duplicateRow as IDataObject, field);
		const inputValue = desiredFields[field];

		const isMatch = compareDedupField(fieldType, apiValue, inputValue);

		// Track that we compared this field
		compared.push(field);

		if (!isMatch) {
			// Values differ — include in patch and record from/to
			patch[field] = inputValue;
			fieldChanges[field] = { from: apiValue, to: inputValue };
		}
	}

	return { patch, fieldChanges, compared, skipped, warnings };
}

// ─── applyDuplicateUpdate ─────────────────────────────────────────────────────

export interface IApplyDuplicateUpdateOptions {
	/** Autotask entity name as used in constants/entities.ts (e.g. 'ContractCharge') */
	resource: string;
	/** ID of the existing record to PATCH */
	duplicateId: number;
	/**
	 * Parent record ID — required for child entities where the update endpoint is
	 * constructed as `{parent}/{parentId}/{child}` with the entity ID in the body.
	 */
	parentId?: number;
	/** Fields to update (from computeFieldDiffs) */
	patch: Record<string, unknown>;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}

export interface IApplyDuplicateUpdateResult {
	updatedEntity: Record<string, unknown>;
	warnings: string[];
}

/**
 * Apply a PATCH to an existing duplicate record, updating only the fields in `patch`.
 * Delegates to `performPatch` which handles UDF splitting, endpoint construction,
 * and inactive-reference retry.
 *
 * @throws if the PATCH request fails — callers should handle errors.
 */
export async function applyDuplicateUpdate(
	context: IExecuteFunctions,
	options: IApplyDuplicateUpdateOptions,
): Promise<IApplyDuplicateUpdateResult> {
	const {
		resource,
		duplicateId,
		parentId,
		patch,
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied,
	} = options;

	const { response: updatedEntity, warnings } = await performPatch(
		context,
		resource,
		duplicateId,
		patch as IDataObject,
		{ parentId, impersonationResourceId, proceedWithoutImpersonationIfDenied },
	);

	return {
		updatedEntity: updatedEntity as Record<string, unknown>,
		warnings,
	};
}
