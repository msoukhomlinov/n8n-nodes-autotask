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
		"ROLE FIELD: NEVER guess roleID — role names are tenant-specific (e.g. 'Service Desk Tier 1', 'Project Engineer'). Omit roleID entirely to auto-default to the resource's defaultServiceDeskRoleID — correct for most time logging. If a non-default role is required, FIRST call autotask_timeEntry with operation 'getAvailableRoles' (resourceID + ticketID) to list valid role names, then pass the exact name or numeric id.",
};
