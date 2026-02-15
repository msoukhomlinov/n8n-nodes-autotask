/**
 * Shared helper for temporarily activating inactive Autotask contacts and
 * resources so that API write operations referencing them can succeed.
 *
 * The Autotask REST API rejects create/update requests when a reference field
 * (e.g. `contactID`, `createdByPersonID`) points to an inactive entity.  The
 * workaround is to temporarily activate the entity, perform the operation, then
 * deactivate it again in a `finally` block so it is always restored.
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   parseInactiveRefError,
 *   withTemporaryActivation,
 *   withInactiveRefRetry,
 * } from '../../helpers/inactive-entity-activation';
 * ```
 *
 * **Option A — automatic retry wrapper (simplest):**
 * ```ts
 * const result = await withInactiveRefRetry(context, warnings, async () => {
 *   return apiCall();
 * });
 * ```
 *
 * **Option B — detect then activate manually:**
 * ```ts
 * try { await apiCall(); }
 * catch (err) {
 *   const ref = parseInactiveRefError(err);
 *   if (!ref) throw err;
 *   await withTemporaryActivation(context, ref, warnings, async () => apiCall());
 * }
 * ```
 */

import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest, buildChildEntityUrl } from './http';

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

/**
 * Pattern the Autotask REST API uses when a reference field points to an
 * inactive (or soft-deleted) contact or resource.
 *
 * Examples observed in the wild:
 *   "contactID: Value 12345 does not exist or is invalid"
 *   "createdByPersonID: Value 67890 does not exist or is invalid"
 */
const INACTIVE_REF_PATTERN =
	/(\w+ID)\s*:\s*Value\s+(\d+)\s+does not exist or is invalid/i;

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

/** Fields that reference a Contact entity (child of Company). */
const CONTACT_REF_FIELDS = new Set([
	'contactid',
]);

/** Fields that reference a Resource entity. */
const RESOURCE_REF_FIELDS = new Set([
	'resourceid',
	'createdbypersonid',
	'lastupdatedbypersonid',
	'assignedresourceid',
	'lastactivitybyresourceid',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InactiveRefInfo {
	field: string;
	entityId: number;
	entityType: 'Contact' | 'Resource';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an Autotask API error and, if it matches the "inactive entity"
 * pattern, return structured information about the offending reference.
 *
 * Returns `null` when the error is unrelated.
 */
export function parseInactiveRefError(error: unknown): InactiveRefInfo | null {
	const message = error instanceof Error ? error.message : String(error);
	const match = INACTIVE_REF_PATTERN.exec(message);
	if (!match) return null;

	const field = match[1];
	const entityId = Number.parseInt(match[2], 10);
	if (!Number.isInteger(entityId) || entityId <= 0) return null;

	const fieldLower = field.toLowerCase();

	if (CONTACT_REF_FIELDS.has(fieldLower) || fieldLower.endsWith('contactid')) {
		return { field, entityId, entityType: 'Contact' };
	}
	if (RESOURCE_REF_FIELDS.has(fieldLower) || fieldLower.endsWith('resourceid')) {
		return { field, entityId, entityType: 'Resource' };
	}

	// Unknown field — do NOT guess. Returning null prevents the helper from
	// accidentally deactivating an unrelated record.
	console.warn(
		`[InactiveEntityActivation] Matched error pattern for field "${field}" (ID ${entityId}) but field is not a recognised contact or resource reference. Skipping automatic retry.`,
	);
	return null;
}

/**
 * Convenience predicate — returns `true` when the error looks like an
 * inactive-entity rejection from the Autotask API.
 */
export function isInactiveEntityError(error: unknown): boolean {
	return parseInactiveRefError(error) !== null;
}

/**
 * Temporarily activate an inactive contact or resource, execute the provided
 * operation callback, then deactivate it again in a `finally` block.
 *
 * If deactivation fails, a human-readable warning is appended to `warnings`
 * but the operation result is still returned (best-effort restore).
 */
export async function withTemporaryActivation<T>(
	context: IExecuteFunctions,
	ref: InactiveRefInfo,
	warnings: string[],
	runOperation: () => Promise<T>,
): Promise<T> {
	const patchEndpoint = await resolvePatchEndpoint(context, ref);

	console.warn(
		`[InactiveEntityActivation] ${ref.field} references inactive ${ref.entityType} ${ref.entityId}; temporarily activating, then deactivating again.`,
	);

	await autotaskApiRequest.call(context, 'PATCH', patchEndpoint, {
		id: ref.entityId,
		isActive: ref.entityType === 'Resource' ? true : 1,
	});

	try {
		return await runOperation();
	} finally {
		try {
			await autotaskApiRequest.call(context, 'PATCH', patchEndpoint, {
				id: ref.entityId,
				isActive: ref.entityType === 'Resource' ? false : 0,
			});
			console.warn(
				`[InactiveEntityActivation] ${ref.entityType} ${ref.entityId} deactivated again.`,
			);
		} catch (deactivateError) {
			const msg =
				`Failed to deactivate ${ref.entityType} ${ref.entityId} after operation completed. Please deactivate manually.`;
			console.warn(`[InactiveEntityActivation] ${msg}`, deactivateError);
			warnings.push(msg);
		}
	}
}

/**
 * All-in-one wrapper: attempt the operation; if it fails because a reference
 * field points to an inactive entity, temporarily activate it and retry once.
 */
export async function withInactiveRefRetry<T>(
	context: IExecuteFunctions,
	warnings: string[],
	runOperation: () => Promise<T>,
): Promise<T> {
	try {
		return await runOperation();
	} catch (error) {
		const ref = parseInactiveRefError(error);
		if (!ref) throw error;

		return withTemporaryActivation(context, ref, warnings, runOperation);
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the correct PATCH endpoint depending on whether the inactive entity
 * is a Contact (child of Company — needs companyID) or a Resource (top-level).
 */
async function resolvePatchEndpoint(
	context: IExecuteFunctions,
	ref: InactiveRefInfo,
): Promise<string> {
	if (ref.entityType === 'Contact') {
		const contactResponse = await autotaskApiRequest.call(
			context,
			'GET',
			`Contacts/${ref.entityId}/`,
		) as { item?: IDataObject };

		const companyId = Number(contactResponse?.item?.companyID ?? 0);
		if (!companyId) {
			throw new Error(
				`Cannot temporarily activate contact ${ref.entityId}: unable to determine its companyID`,
			);
		}

		// PATCH goes to the collection endpoint (no entityId in path) — the
		// Autotask API only allows GET and DELETE on the individual contact URL.
		return buildChildEntityUrl('Company', 'Contact', companyId);
	}

	return 'Resources/';
}
