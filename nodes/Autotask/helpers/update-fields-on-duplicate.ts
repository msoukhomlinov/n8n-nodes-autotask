import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { buildEntityUrl, buildChildEntityUrl } from './http';
import { compareDedupField } from './dedup-utils';
import { getEntityMetadata } from '../constants/entities';
import { OperationType } from '../types/base/entity-types';

// ─── computeFieldDiffs ────────────────────────────────────────────────────────

export interface IFieldDiffResult {
	/** Fields that differ between the duplicate and desired values (API values to PATCH) */
	patch: Record<string, unknown>;
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
 * @param desiredFields  - The caller's intended field values (e.g. from createFields)
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
		const apiValue = duplicateRow[field];
		const inputValue = desiredFields[field];

		const isMatch = compareDedupField(fieldType, apiValue, inputValue);

		// Track that we compared this field
		compared.push(field);

		if (!isMatch) {
			// Values differ — include in patch
			patch[field] = inputValue;
		}
		// If isMatch === true the field is already up to date; add to compared but not patch
	}

	return { patch, compared, skipped, warnings };
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
 *
 * URL construction mirrors the UpdateOperation logic:
 * - Child entities whose metadata has `operations.update === 'parent'` use the
 *   parent collection URL (`{parent}/{parentId}/{child}`) with `id` in the body.
 * - All other entities use the direct URL (`{entity}/{duplicateId}`).
 *
 * @throws if the PATCH request fails — callers should handle errors.
 */
export async function applyDuplicateUpdate(
	context: IExecuteFunctions,
	options: IApplyDuplicateUpdateOptions,
): Promise<IApplyDuplicateUpdateResult> {
	const warnings: string[] = [];

	const {
		resource,
		duplicateId,
		parentId,
		patch,
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied,
	} = options;

	const metadata = getEntityMetadata(resource);

	// Build PATCH body — always include `id`
	const body: IDataObject = {
		id: duplicateId,
		...(patch as IDataObject),
	};

	// Determine the endpoint
	let endpoint: string;

	if (
		metadata?.childOf &&
		metadata.operations?.[OperationType.UPDATE] === 'parent' &&
		parentId !== undefined
	) {
		// Parent-mode update: POST/PATCH to parent/{parentId}/{child} with id in body
		endpoint = buildChildEntityUrl(metadata.childOf, resource, parentId);
	} else if (metadata) {
		// Direct update: PATCH to {entity}/{duplicateId}
		endpoint = buildEntityUrl(resource, { entityId: duplicateId });
	} else {
		// Fallback for unknown entities — use a simple path and warn
		warnings.push(
			`Entity metadata not found for '${resource}'. Using direct URL pattern as fallback.`,
		);
		endpoint = `${resource}/${duplicateId}`;
	}

	const response = await autotaskApiRequest.call(
		context,
		'PATCH',
		endpoint,
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	) as IDataObject;

	return {
		updatedEntity: (response ?? {}) as Record<string, unknown>,
		warnings,
	};
}
