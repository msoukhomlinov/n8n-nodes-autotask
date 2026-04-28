/**
 * Per-resource language gates used by schema-generator and description-builders.
 *
 * Currently:
 * - RESOURCES_WITH_PRIORITY: resources whose entity has a `priority` picklist field.
 *   When a convenience-op short-circuit (getByCompanyAndStatus, getUnassigned,
 *   countByPeriod, getByAge) is generated for a resource NOT in this set, the
 *   `priority` schema field is omitted entirely so the LLM cannot pass it.
 * - RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION: resources whose getMany operation
 *   supports the `excludeTerminalStatuses` parameter (defaults true). The actual
 *   terminal status IDs live in RESOURCE_CONVENIENCE_CONFIG in tool-executor.ts.
 */

export const RESOURCES_WITH_PRIORITY: ReadonlySet<string> = new Set(['ticket']);

export const RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION: ReadonlySet<string> = new Set([
	'ticket',
	'task',
	'project',
]);

export const RESOURCE_EXTRA_HINTS: Readonly<Record<string, string>> = {
	timeEntry:
		"ROLE SELECTION: When creating a time entry without an explicit roleID, first call this tool with operation 'getAvailableRoles' passing resourceID and ticketID (or queueID + contractID). The response lists active roles available for the resource on that queue with contract-excluded roles already removed. Each role includes roleName and roleDescription — choose the role whose description best matches the work context (e.g. business-hours, after-hours, weekend, remote, sales). If a suggestedDefault role is flagged in the response, prefer it unless context requires otherwise. Avoid guessing role names — always call getAvailableRoles first.",
};
