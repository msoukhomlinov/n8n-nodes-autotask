import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest, buildEntityUrl, buildChildEntityUrl } from './http';
import { compareDedupField, getEntityFieldValue } from './dedup-utils';
import { getEntityMetadata } from '../constants/entities';
import { OperationType } from '../types/base/entity-types';
import { getFields } from './entity/api';
import type { IUdfFieldDefinition } from '../types/base/udf-types';

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

	// Guard: nothing to do if patch is empty
	if (Object.keys(patch).length === 0) {
		return { updatedEntity: {}, warnings: ['applyDuplicateUpdate called with empty patch — skipped'] };
	}

	// Resolve entity metadata first so we can branch on it without calling buildEntityUrl
	// (which throws for unknown entities) before we have a chance to fall back.
	const metadata = getEntityMetadata(resource);

	// Split patch into standard fields and UDF fields.
	// UDF fields must be sent as userDefinedFields[{name, value}]; sending them flat causes 500.
	let patchStandard: IDataObject = { ...(patch as IDataObject) };
	let udfEntries: Array<{ name: string; value: unknown }> = [];

	if (metadata?.hasUserDefinedFields) {
		try {
			const udfDefs = await getFields(resource, context, { fieldType: 'udf' }) as IUdfFieldDefinition[];
			if (udfDefs.length > 0) {
				const udfNameSet = new Set(udfDefs.map(u => u.name.toLowerCase()));
				const udfKeys = Object.keys(patch).filter(k => udfNameSet.has(k.toLowerCase()));
				if (udfKeys.length > 0) {
					udfEntries = udfKeys.map(k => ({ name: k, value: (patch as IDataObject)[k] }));
					patchStandard = Object.fromEntries(
						Object.entries(patch as IDataObject).filter(([k]) => !udfKeys.includes(k)),
					);
				}
			}
		} catch {
			// UDF metadata unavailable — send all patch fields as standard root fields.
			// If any are genuine UDF fields, Autotask will return a field-not-found error
			// on the PATCH, which is more actionable than throwing before the request.
			warnings.push(
				`applyDuplicateUpdate: could not fetch UDF definitions for '${resource}' — patch sent without UDF splitting. If the patch contains UDF fields, the PATCH may fail.`,
			);
		}
	}

	// Build PATCH body — always include `id`
	const body: IDataObject = {
		id: duplicateId,
		...patchStandard,
		...(udfEntries.length > 0 ? { userDefinedFields: udfEntries } : {}),
	};

	// Determine the endpoint
	let endpoint: string;

	if (metadata?.childOf && metadata.operations?.[OperationType.UPDATE] === 'parent') {
		// Parent-mode update: POST/PATCH to parent/{parentId}/{child} with id in body
		if (!parentId) {
			throw new Error(
				`applyDuplicateUpdate: parentId is required for child entity '${resource}' but was not provided`,
			);
		}
		endpoint = buildChildEntityUrl(metadata.childOf, resource, parentId);
	} else if (metadata) {
		// Direct update: PATCH to collection endpoint — Autotask REST API pattern requires
		// id in the body, not the URL. PATCH /{entity}/{id} returns 405 for all root entities.
		endpoint = buildEntityUrl(resource);
	} else {
		// Fallback for unknown entities — construct URL manually and warn rather than throw
		warnings.push(
			`applyDuplicateUpdate: unknown entity '${resource}' — metadata not found, constructing PATCH URL manually.`,
		);
		endpoint = `/atservicesrest/v1.0/${resource}`;
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
