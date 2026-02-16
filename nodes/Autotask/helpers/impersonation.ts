import type { IExecuteFunctions } from 'n8n-workflow';

/**
 * Autotask entities that support impersonation, per the REST API docs.
 * @see https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/_EntitiesOverview.htm
 *
 * The set contains lowercased plural URL segments as they appear at the start
 * of API endpoints (e.g. `ConfigurationItems/123/` → `configurationitems`).
 */
const IMPERSONATION_SUPPORTED_SEGMENTS = new Set([
	'attachmentinfo',
	'companies',
	'companynotes',
	'companynoteattachments',
	'companytodos',
	'contacts',
	'contractnotes',
	'configurationitems',
	'configurationitemnotes',
	'configurationitemnoteattachments',
	'configurationitemattachments',
	'inventoryitems',
	'inventorylocations',
	'opportunities',
	'products',
	'productnotes',
	'projects',
	'projectnotes',
	'purchaseorders',
	'quotes',
	'salesorders',
	'servicecalls',
	'subscriptions',
	'tasknotes',
	'tickets',
	'ticketnotes',
	'timeentries',
]);

/**
 * n8n node resource keys that map to entities where Autotask supports
 * impersonation for write operations.
 */
const NODE_RESOURCE_IMPERSONATION_SUPPORTED = new Set([
	'company',
	'companyNote',
	'contact',
	'contractNote',
	'configurationItems',
	'configurationItemNote',
	'opportunity',
	'product',
	'project',
	'projectNote',
	'quote',
	'serviceCall',
	'subscription',
	'ticket',
	'ticketNote',
	'timeEntry',
]);

/**
 * Check whether a node resource supports impersonation for create/update.
 */
export function isNodeResourceImpersonationSupported(resourceName: string): boolean {
	return NODE_RESOURCE_IMPERSONATION_SUPPORTED.has(resourceName);
}

/**
 * Check whether an API endpoint supports impersonation based on the
 * entity type derived from the URL.
 *
 * Rules:
 * 1. Extract the first path segment (the root entity, e.g. `ConfigurationItems`).
 * 2. If the endpoint contains `/Attachments` anywhere, treat it as AttachmentInfo
 *    (which is in the supported list).
 * 3. Check the root segment against the supported set.
 *
 * Returns `true` when the endpoint is known to support impersonation,
 * `false` otherwise.
 */
export function isImpersonationSupportedForEndpoint(endpoint: string): boolean {
	// Normalise: strip leading protocol/domain if present (pagination URLs)
	let path = endpoint;
	if (path.startsWith('http')) {
		try {
			path = new URL(path).pathname;
		} catch {
			// Fall through with original
		}
	}

	// Attachment child endpoints are backed by AttachmentInfo
	if (/\/attachments\b/i.test(path)) {
		return true;
	}

	// Extract the first meaningful segment
	const firstSegment = path.replace(/^\/+/, '').split('/')[0]?.toLowerCase();
	if (!firstSegment) return false;

	return IMPERSONATION_SUPPORTED_SEGMENTS.has(firstSegment);
}

/**
 * Extracts and validates an optional impersonation resource ID from node parameters.
 * Used by copy/move operations to attribute created records to a specific resource.
 *
 * @param context - n8n execute context
 * @param itemIndex - Item index for parameter lookup
 * @param parameterName - Parameter name (default: 'impersonationResourceId')
 * @returns Valid positive integer, or undefined if empty/omitted
 * @throws Error if value is non-empty but not a valid positive integer
 */
export function getOptionalImpersonationResourceId(
	context: IExecuteFunctions,
	itemIndex: number,
	parameterName = 'impersonationResourceId',
): number | undefined {
	const raw = context.getNodeParameter(parameterName, itemIndex, '') as string | number;
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (typeof raw === 'number') {
		if (Number.isInteger(raw) && raw > 0) return raw;
		throw new Error(
			`${parameterName} must be a positive integer when provided. Got: ${raw}.`,
		);
	}
	const trimmed = String(raw).trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			`${parameterName} must be a positive integer when provided. Got: "${raw}".`,
		);
	}
	return parsed;
}
