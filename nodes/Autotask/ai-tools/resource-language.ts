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
		"ROLE: roleID auto-defaults to the resource's defaultServiceDeskRoleID — omit it for standard time logging. Only provide roleID explicitly when the work context requires a non-default role (e.g. onsite visit, after-hours, travel). In that case call operation 'getAvailableRoles' with resourceID and ticketID to see valid options with descriptions — never guess role names.",
};
