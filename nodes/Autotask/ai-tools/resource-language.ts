/**
 * Per-resource language gates used by schema-generator and description-builders.
 *
 * Currently:
 * - RESOURCES_WITH_PRIORITY: resources whose entity has a `priority` picklist field.
 *   When a convenience-op short-circuit (getByCompanyAndStatus, getUnassigned,
 *   countByPeriod, getByAge) is generated for a resource NOT in this set, the
 *   `priority` schema field is omitted entirely so the LLM cannot pass it.
 */

export const RESOURCES_WITH_PRIORITY: ReadonlySet<string> = new Set(['ticket']);
