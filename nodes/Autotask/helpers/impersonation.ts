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
	// R2 (C3): the endpoint gate (isImpersonationSupportedForEndpoint) already accepts
	// /purchaseorders and every /attachments child route (backed by AttachmentInfo);
	// the node resource keys below are the ones that exist in resources/definitions.ts,
	// so the UI can advertise the field the executor actually honours for them.
	'expenseItemAttachment',
	'opportunity',
	'opportunityAttachment',
	'product',
	'project',
	'projectNote',
	'purchaseOrders',
	'quote',
	'serviceCall',
	'subscription',
	'ticket',
	'ticketAttachment',
	'ticketNote',
	'ticketNoteAttachment',
	'timeEntry',
	'timeEntryAttachment',
]);

/**
 * Check whether a node resource supports impersonation for create/update.
 */
export function isNodeResourceImpersonationSupported(resourceName: string): boolean {
	return NODE_RESOURCE_IMPERSONATION_SUPPORTED.has(resourceName);
}

/**
 * x4 (Codex P2 on PR #148): operation-scoped impersonation support.
 *
 * `resource` (Autotask Resource) is NOT impersonation-capable as an entity —
 * `/Resources/` is not in IMPERSONATION_SUPPORTED_SEGMENTS, so `resource.update`
 * must not advertise the field (the base UpdateOperation's endpoint gate would
 * silently ignore it — the X9 model trap). But `resource.transferOwnership`
 * forwards impersonationResourceId to the reassignment sub-calls
 * (Companies/Tickets/Tasks/Projects/Opportunities PATCH + note POSTs), which ARE
 * on supported segments. 'resource' is the only resource registering
 * transferOwnership, so the exemption is naturally op-scoped. Adding 'resource'
 * to the resource-level set instead would co-advertise the field on
 * resource.update — exactly the trap this split avoids.
 */
export function isOperationImpersonationSupported(
	resourceName: string | undefined,
	operations: readonly string[],
): boolean {
	if (
		resourceName === undefined ||
		isNodeResourceImpersonationSupported(resourceName)
	) {
		return true;
	}
	return (
		resourceName === 'resource' && operations.includes('transferOwnership')
	);
}

/**
 * x4 (Codex P2e): per-CALL impersonation support. The unified schema exposes
 * impersonationResourceId whenever the resource's operation SET contains an
 * impersonation-capable operation (isOperationImpersonationSupported), so a
 * single tool can mix supported (resource.transferOwnership — its reassignment
 * sub-calls hit Companies/Tickets/...) and unsupported (resource.update →
 * /Resources/) operations. The executor answers this predicate per call and
 * REJECTS the parameter when the called operation's endpoint would silently
 * drop it — a success response must never imply attribution that was ignored.
 */
export function operationSupportsImpersonation(
	resourceName: string | undefined,
	operation: string,
): boolean {
	if (
		resourceName === undefined ||
		isNodeResourceImpersonationSupported(resourceName)
	) {
		return true;
	}
	return resourceName === 'resource' && operation === 'transferOwnership';
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

/**
 * Forward impersonation options for an attachment create call — the five
 * hand-rolled attachment resources (Ticket/TicketNote/TimeEntry/ExpenseItem/
 * OpportunityAttachments) all need this identical resolve-or-fall-back logic.
 */
export function resolveAttachmentImpersonationOptions(
	context: IExecuteFunctions,
	itemIndex: number,
	endpoint: string,
): { impersonationResourceId: number | undefined; proceedWithoutImpersonationIfDenied: boolean } {
	let impersonationResourceId: number | undefined;
	let proceedWithoutImpersonationIfDenied = false;
	if (isImpersonationSupportedForEndpoint(endpoint)) {
		try {
			impersonationResourceId = getOptionalImpersonationResourceId(context, itemIndex);
			if (impersonationResourceId !== undefined) {
				proceedWithoutImpersonationIfDenied = context.getNodeParameter(
					'proceedWithoutImpersonationIfDenied',
					itemIndex,
					true,
				) as boolean;
			}
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes('Could not get parameter')
			) {
				impersonationResourceId = undefined;
			} else {
				// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
				throw error;
			}
		}
	}
	return { impersonationResourceId, proceedWithoutImpersonationIfDenied };
}
