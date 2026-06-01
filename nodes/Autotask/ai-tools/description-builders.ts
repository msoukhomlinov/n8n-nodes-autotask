import type { FieldMeta } from '../helpers/aiHelper';
import { getEntityMetadata } from '../constants/entities';
import { getAiIdentityHint } from '../constants/ai-identity';
import { AI_TOOL_DEBUG_VERBOSE, redactForVerbose, traceDescriptionBuild } from './debug-trace';
import { getOperationContractRuleText } from './operation-contracts';
import { isWriteOperation } from './operation-metadata';
import { RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION, RESOURCE_EXTRA_HINTS } from './resource-language';
import { MAX_RESPONSE_RECORDS } from './operation-handlers/operation-dispatch';

export const DESCRIPTION_REFERENCE_PLACEHOLDER = '__REFERENCE_UTC__';

interface ResourceLanguageConfig {
	label: string;
	hasPriority: boolean;
	terminalStatusLabel: string;
	assignedFieldLabel: string;
	getFullDetailMode: 'sla' | 'simple';
}

const RESOURCE_LANGUAGE_CONFIG: Record<string, ResourceLanguageConfig> = {
	ticket: {
		label: 'tickets',
		hasPriority: true,
		terminalStatusLabel: 'Complete or Cancelled',
		assignedFieldLabel: 'assigned resource',
		getFullDetailMode: 'sla',
	},
	task: {
		label: 'tasks',
		hasPriority: false,
		terminalStatusLabel: 'Complete',
		assignedFieldLabel: 'assigned resource',
		getFullDetailMode: 'simple',
	},
	project: {
		label: 'projects',
		hasPriority: false,
		terminalStatusLabel: 'Complete',
		assignedFieldLabel: 'project lead',
		getFullDetailMode: 'simple',
	},
};

export function buildToolContractBlock(): string {
	return [
		'CAPABILITIES: filter/count/paging only. No groupBy/aggregation/server-side sort. Cross-entity lookups need two steps (child first → parent with filter_op=in), except documented convenience ops.',
		"EFFICIENCY: use operation='count' for totals-only questions. For grouped/top-N analysis pair operation='getMany' with sparse fields (e.g. fields='id,city') + returnAll=true — sparse fields lifts the 500-record payload cap. Aggregation is client-side.",
		'ERRORS: when "error":true, the "nextAction" field is a directive — execute it before retrying. Never retry an unchanged failed call.',
	].join('\n');
}

const DESCRIPTION_TEMPLATE_CACHE_MAX = 600;
const descriptionTemplateCache = new Map<string, string>();

function listFilterableFields(readFields: FieldMeta[], max = 12): string {
	return readFields
		.filter((field) => !field.udf)
		.slice(0, max)
		.map((field) => field.id)
		.join(', ');
}

function listDateTimeFieldHint(readFields: FieldMeta[]): string {
	const dateFields = readFields
		.filter((field) => !field.udf && field.type.toLowerCase().includes('date'))
		.map((field) => field.id);
	if (dateFields.length === 0) return '';
	return (
		`Date/time fields available for recency/since/until: ${dateFields.join(', ')}. ` +
		`Use recency_field to specify which date field to filter on — choose the field that best matches the query intent. `
	);
}

function getParentRequirement(resourceName: string): string | null {
	const metadata = getEntityMetadata(resourceName);
	return metadata?.parentIdField ?? null;
}

/** Snippet injected into tool descriptions that reference date/time so the AI uses actual "now" instead of training cutoff. */
export function dateTimeReferenceSnippet(referenceUtc: string): string {
	return `Current UTC date-time: ${referenceUtc}. Use for recency/since/until, not training-cutoff defaults. `;
}

function getDescriptionFieldSignature(fields: FieldMeta[]): string {
	return fields
		.map((field) =>
			[
				field.id,
				field.required ? '1' : '0',
				field.type ?? '',
				field.isPickList ? '1' : '0',
				field.isReference ? '1' : '0',
				field.referencesEntity ?? '',
				Array.isArray(field.allowedValues) ? field.allowedValues.length : 0,
			].join(':'),
		)
		.sort()
		.join('|');
}

function getDescriptionTemplateCacheKey(
	resource: string,
	operations: string[],
	readFields: FieldMeta[],
	writeFields: FieldMeta[],
	supportsImpersonation: boolean,
): string {
	const opSig = [...operations].sort().join(',');
	const readSig = getDescriptionFieldSignature(readFields);
	const writeSig = getDescriptionFieldSignature(writeFields);
	return `${resource}|${opSig}|imp:${supportsImpersonation ? '1' : '0'}|r:${readSig}|w:${writeSig}`;
}

function setDescriptionTemplateCache(key: string, value: string): void {
	if (descriptionTemplateCache.size >= DESCRIPTION_TEMPLATE_CACHE_MAX) {
		const firstKey = descriptionTemplateCache.keys().next().value as string | undefined;
		if (firstKey) descriptionTemplateCache.delete(firstKey);
	}
	descriptionTemplateCache.set(key, value);
}

/** Rule for getMany/count/getPosted/getUnposted: how recency and since/until interact. */
const RECENCY_VS_SINCE_UNTIL_RULE =
	"Temporal filter decision tree:\n- \"recent/latest/last N days/today/this week\" → recency param (e.g. last_7d). recency = LOWER BOUND (records newer than cutoff).\n- \"since date X / after date X\" → use since= param. since is a LOWER BOUND (records >= timestamp).\n- \"fixed range e.g. Q1 2026\" → since= + until=.\n- \"older than N days / before date X / stale / not touched since X\" → filter_field with filter_op='lt' on a date field (createDate, lastActivityDate, dueDateTime). 'lt' = UPPER BOUND. Do NOT use since/until for upper-bound queries.\n- Combination (between A and B) → two filter triplets: filter_op='gt' for inner bound + filter_op='lt' for outer bound on same field. ";

/** Warning shared by list-family builders and LIST_ADVANCED_NOTES about API ordering. */
const ASCENDING_ID_WARNING =
	'API ordering: records always return in ascending ID order (oldest first). No server-side sort is available.';

/** Template for the "call describeFields if uncertain" hint used across individual builders. */
function describeFieldsHint(resourceName: string, mode: 'read' | 'write' | '' = ''): string {
	const modeClause = mode ? ` (mode '${mode}')` : '';
	return `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields'${modeClause} first.`;
}

export function buildGetDescription(resourceLabel: string, resourceName: string): string {
	return (
		`Retrieve a single ${resourceLabel} record by numeric ID. ` +
		`ONLY call this when you already have a numeric ID — never pass a name or text. ` +
		`If you only have a name or description, call autotask_${resourceName} with operation 'getMany' with a filter first, extract the 'id' from results, then call this. ` +
		`Optionally use 'fields' to return only selected columns. ` +
		`If a record should exist but response is empty, verify API user permissions (including line-of-business access). ` +
		`Do not guess field names. ${describeFieldsHint(resourceName, 'read')}`
	);
}

export function buildGetManyDescription(
	resourceLabel: string,
	resourceName: string,
	readFields: FieldMeta[],
	terminalStatusLabel?: string,
	referenceUtc?: string,
): string {
	const fieldList = listFilterableFields(readFields);
	const dateFieldHint = listDateTimeFieldHint(readFields);
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	const terminalHint = terminalStatusLabel
		? `By default excludes terminal statuses (${terminalStatusLabel}) — set excludeTerminalStatuses=false only when user explicitly asks for closed/historical records. `
		: '';

	return (
		ref +
		`Search ${resourceLabel} with up to two filters (AND default; filter_logic='or' for either-match; use filtersJson for 3+ filters or nested groups). ` +
		`Example: filter_field='companyName', filter_op='contains', filter_value='Acme'. ` +
		`Picklist/reference fields accept names (auto-resolved). Use filter_op='notExist'/'exist' for null checks. ` +
		terminalHint +
		`Filterable: ${fieldList}. ` +
		`${ASCENDING_ID_WARNING} ` +
		`Use recency/since/until for date ranges; filter_op='lt' on date fields for older-than queries. ` +
		dateFieldHint +
		describeFieldsHint(resourceName)
	);
}

export function buildCountDescription(resourceLabel: string, referenceUtc?: string): string {
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	return (
		ref +
		`Count ${resourceLabel} records matching optional filters — returns the total only, no records. ` +
		`Same filter params as getMany. ` +
		`For efficient polling-style checks, prefer LastModifiedDate or LastActivityDate filters where available.`
	);
}

/** Max number of picklist values to inline in the required-fields summary */
const MAX_INLINE_REQUIRED_PICKLIST = 4;

/**
 * Build a compact required-fields summary for create/update descriptions.
 * For each required field, shows type info (reference target, picklist values, or data type).
 */
function buildRequiredFieldsSummary(writeFields: FieldMeta[]): string {
	const required = writeFields.filter((field) => field.required);
	if (required.length === 0) return 'Required fields: none.';

	const parts = required.map((field) => {
		let info = field.id;
		if (field.isReference && field.referencesEntity) {
			info += ` (ref→${field.referencesEntity})`;
		} else if (field.isPickList && field.allowedValues?.length) {
			if (field.allowedValues.length <= MAX_INLINE_REQUIRED_PICKLIST) {
				const vals = field.allowedValues.map((v) => v.label).join('|');
				info += ` (picklist: ${vals})`;
			} else {
				info += ` [${field.allowedValues.length} values; use listPicklistValues]`;
			}
		} else if (field.isPickList) {
			info += ` (picklist — use listPicklistValues for options)`;
		} else {
			info += ` (${field.type})`;
		}
		return info;
	});
	return `Required fields: ${parts.join(', ')}.`;
}

export function buildCreateDescription(
	resourceLabel: string,
	resourceName: string,
	writeFields: FieldMeta[],
	referenceUtc?: string,
): string {
	const requiredSummary = buildRequiredFieldsSummary(writeFields);
	const parentField = getParentRequirement(resourceName);
	const parentHint = parentField ? ` Parent relation required: include ${parentField}.` : '';
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	const extraHint = RESOURCE_EXTRA_HINTS[resourceName] ?? '';

	return (
		ref +
		`Create a new ${resourceLabel} record. ` +
		`${requiredSummary}${parentHint} ` +
		`Picklist and reference fields accept human-readable names — auto-resolved to IDs. ` +
		`Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
		`Confirm field values with user before executing when acting autonomously. ` +
		`If picklist values fail validation, call autotask_${resourceName} with operation 'listPicklistValues'.` +
		(extraHint ? ` ${extraHint}` : '')
	);
}

export function buildUpdateDescription(
	resourceLabel: string,
	resourceName: string,
	writeFields: FieldMeta[],
	referenceUtc?: string,
): string {
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	const extraHint = RESOURCE_EXTRA_HINTS[resourceName] ?? '';
	const requiredOnCreate = writeFields.filter((f) => f.required);
	const createFieldsNote =
		requiredOnCreate.length > 0
			? `Fields required on create (PATCH preserves existing value if omitted — only supply if changing): ${buildRequiredFieldsSummary(writeFields).replace(/^Required fields: /i, '')} `
			: '';
	return (
		ref +
		`Update an existing ${resourceLabel} record by numeric ID. ` +
		`PREREQUISITE: you need the numeric ID. If you only have a name or text, call autotask_${resourceName} with operation 'getMany' with a filter to find the record and get its 'id' first. ` +
		`Only provide fields to change (PATCH-style behaviour). ` +
		`Do not assume PUT-style replacement where omitted fields become null. ` +
		createFieldsNote +
		`Picklist and reference fields accept human-readable names — auto-resolved to IDs. ` +
		`Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
		`Confirm field values with user before executing when acting autonomously. ` +
		`${describeFieldsHint(resourceName, 'write')} ` +
		`Use autotask_${resourceName} with operation 'listPicklistValues' for picklist fields.` +
		(extraHint ? ` ${extraHint}` : '')
	);
}

export function buildDeleteDescription(resourceLabel: string, resourceName: string): string {
	return (
		`Delete a ${resourceLabel} record by numeric ID. ` +
		`ONLY on explicit user intent. Do not infer delete intent from context. Confirm ID is correct before proceeding. ` +
		`Operational delete responses may be minimal, so treat non-200 outcomes as failures. ` +
		`Use autotask_${resourceName} with operation 'getMany' or autotask_${resourceName} with operation 'get' first to confirm the correct ID before deletion.`
	);
}

export function buildWhoAmIDescription(resourceLabel: string): string {
	return (
		`Resolve the current authenticated ${resourceLabel} record from API credentials. ` +
		`Use this to discover the active Autotask user context before running user-scoped actions. ` +
		`Optionally use 'fields' to limit returned columns.`
	);
}

export function buildPostedTimeEntriesDescription(
	resourceName: string,
	referenceUtc?: string,
): string {
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	return (
		ref +
		`Get posted time entries (entries with matching Billing Items). ` +
		`Supports optional filters: filter_field/filter_op/filter_value (up to two, AND by default; set filter_logic='or' for either-match), or filtersJson for advanced multi-condition queries. Also accepts limit, returnAll, since, until, recency, and fields. ` +
		`${ASCENDING_ID_WARNING} ` +
		describeFieldsHint(resourceName)
	);
}

export function buildUnpostedTimeEntriesDescription(
	resourceName: string,
	referenceUtc?: string,
): string {
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	return (
		ref +
		`Get unposted time entries (entries without matching Billing Items). ` +
		`Supports optional filters: filter_field/filter_op/filter_value (up to two, AND by default; set filter_logic='or' for either-match), or filtersJson for advanced multi-condition queries. Also accepts limit, returnAll, since, until, recency, and fields. ` +
		`${ASCENDING_ID_WARNING} ` +
		describeFieldsHint(resourceName)
	);
}

export function buildCompanySearchByDomainDescription(resourceName: string): string {
	return (
		'Search companies by domain using website-style fields. ' +
		'Identifier priority for company resolution: first extract/use domain from any provided email or website, then use company-name contains matching only as fallback. ' +
		'Input can be a bare domain or full URL; the tool normalises it to a domain fragment (for example autotask.net). ' +
		'IMPORTANT: Autotask typically stores company websites as full URLs (for example https://www.autotask.net/), so exact operator matches can fail on bare domain input. ' +
		'To avoid false negatives, eq/like semantics are handled safely for website matching. ' +
		'When searchContactEmails is true (default), if no company website matches exist, the tool searches Contact.emailAddress by domain and resolves the most common canonical company name from companyID references. ' +
		"Use the 'fields' parameter to limit which company fields are returned per result (comma-separated); omit to receive the full company entity. matchedField and matchedValue are always included to indicate which website field matched and its value. " +
		describeFieldsHint(resourceName)
	);
}

export function buildCompanySearchByIdentityDescription(resourceName: string): string {
	return (
		'Preferred AI company resolution operation. Accepts companyName, email, and website/domain, then ranks candidates by confidence. ' +
		'Domain is normalised from website first, then email; domain matching is attempted first (company website fields, then contact-email fallback). ' +
		'If domain signals are weak or absent, companyName contains matching is executed and merged into a confidence-ranked candidate list. ' +
		'Use this operation as first choice for company lookup when identity hints may be incomplete or noisy. ' +
		"Use the 'fields' parameter to limit returned company fields; omit for full records. " +
		describeFieldsHint(resourceName)
	);
}

export function buildTicketSummaryDescription(resourceName: string): string {
	const ruleText = getOperationContractRuleText(resourceName, 'summary');
	const identifierRule = ruleText.length > 0 ? `${ruleText.join(' ')} ` : '';
	return (
		'Compact, type-aware ticket summary (auto-detects Service Request/Incident/Problem/Change Request/Alert). ' +
		identifierRule +
		"Returns a 'computed' block (age, SLA status, overdue flags) and a 'relationships' block when linked. " +
		"'includeChildCounts=true' adds child-entity counts (extra parallel API calls; off by default). " +
		"'summaryTextLimit' caps description/resolution length (default 500 chars). " +
		"'includeRaw=true' returns the full enriched pre-alias payload (raw changeInfoField{N} keys, no null filtering). " +
		'For full SLA milestone timing, use slaHealthCheck instead. ' +
		"For population-level SLA queries (e.g. 'how many breached this week?'), use operation 'count' or 'getMany' with filter_field='serviceLevelAgreementHasBeenMet', filter_op='eq', filter_value=false. " +
		describeFieldsHint(resourceName)
	);
}

export function buildTicketGetFullDetailDescription(resourceName: string): string {
	return buildGetFullDetailDescription(resourceName);
}

export function buildGetFullDetailDescription(resource: string): string {
	const lang = RESOURCE_LANGUAGE_CONFIG[resource];
	if (!lang || lang.getFullDetailMode === 'sla') {
		// Preserve ticket prose exactly as before
		return (
			"Get a ticket's complete data including SLA status and a plain-text summary in one call. " +
			"Supply EITHER numeric 'id' OR 'ticketNumber' (e.g. T20240615.0123). " +
			"Response includes all ticket fields, 'slaStatus' (breached/compliant/paused/no_sla/unknown), " +
			"'slaBreachDateTime' (resolvedDueDateTime), and 'summaryText' (plain-English one-liner). " +
			"Use this instead of calling get + slaHealthCheck separately when you need both ticket data and SLA status. " +
			describeFieldsHint(resource)
		);
	}
	return (
		`Get a ${resource}'s complete data plus child entity counts in one call. ` +
		`Supply numeric 'id'. ` +
		`Response includes all ${resource} fields, 'childCounts' (counts of related notes, time entries, etc.), and 'summaryText'. ` +
		describeFieldsHint(resource)
	);
}

export function buildTicketSlaHealthCheckDescription(resourceName: string): string {
	const ruleText = getOperationContractRuleText(resourceName, 'slaHealthCheck');
	const identifierRule = ruleText.length > 0 ? `${ruleText.join(' ')} ` : '';
	return (
		`Run an SLA health check on a ticket. ${identifierRule}` +
		'Returns first-response, resolution-plan, and resolution milestone timing and status in consistent hours (2 decimal places). ' +
		"Use 'ticketFields' to limit which ticket fields are returned in the ticket section. " +
		'Includes wallClockRemainingHours, where negative values indicate overdue milestones. ' +
		'This operation combines data from Ticket and ServiceLevelAgreementResults entities. ' +
		"For population-level SLA queries (e.g. 'how many breached this week?'), do NOT call slaHealthCheck without an id. Use operation 'count' or 'getMany' with filter_field='serviceLevelAgreementHasBeenMet', filter_op='eq', filter_value=false instead. " +
		describeFieldsHint(resourceName)
	);
}

export function buildTicketTimelineDescription(resourceName: string): string {
	const ruleText = getOperationContractRuleText(resourceName, 'timeline');
	const identifierRule = ruleText.length > 0 ? `${ruleText.join(' ')} ` : '';
	return (
		'Chronological merged event stream (notes, time entries, and optionally field-change history) for a single ticket — use for escalation briefs, effort audits, and manager summaries. ' +
		identifierRule +
		"Events sorted oldest-first. Each event has a 'type' field: 'note' (communications), 'timeEntry' (work logged), or 'history' (field changes). " +
		"Parameters: 'since'/'until' (ISO date — strongly recommended for active tickets to scope results); " +
		"'resourceId' (name or numeric ID — filters note authors, time entry resources, and history actors); " +
		"'includeHistories' (default false — enable for full field-change audit; can be very large on busy tickets — combine with since/until); " +
		"'textLimit' (default 500 chars for note/entry text, 0=no limit); " +
		"'limit' (default 50 per entity type). " +
		"'hasMore: true' in response means at least one entity type hit the per-type cap — narrow with since/until or increase limit. " +
		'For SLA milestone timing use slaHealthCheck. For ticket field overview use summary. ' +
		describeFieldsHint(resourceName)
	);
}

export function buildTicketGetByCompanyAndStatusDescription(resource: string): string {
	return buildGetByCompanyAndStatusDescription(resource);
}

export function buildGetByCompanyAndStatusDescription(resource: string): string {
	const lang = RESOURCE_LANGUAGE_CONFIG[resource];
	const recordsLabel = lang?.label ?? `${resource} records`;
	const optionalParts = ['status'];
	if (lang?.hasPriority) optionalParts.push('priority');
	return (
		`Filter ${recordsLabel} by company and optionally by ${optionalParts.join(' or ')}. ` +
		"Required: 'company' (name or numeric ID, auto-resolved). " +
		`Optional: ${optionalParts.map((p) => `'${p}'`).join(', ')} (labels or numeric IDs, auto-resolved). ` +
		"Use 'recency', 'since', or 'until' to narrow by date. " +
		"Use 'returnAll' for full result sets."
	);
}

export function buildTicketGetUnassignedDescription(resource: string): string {
	return buildGetUnassignedDescription(resource);
}

export function buildGetUnassignedDescription(resource: string): string {
	const lang = RESOURCE_LANGUAGE_CONFIG[resource];
	const recordsLabel = lang?.label ?? `${resource} records`;
	const assignedLabel = lang?.assignedFieldLabel ?? 'assigned resource';
	const terminalLabel = lang?.terminalStatusLabel ?? 'Complete or Cancelled';
	const optionalHint = lang?.hasPriority
		? "'company' (name or ID, auto-resolved), 'priority' (label or ID)"
		: "'company' (name or ID, auto-resolved)";
	return (
		`Return open, unassigned ${recordsLabel} (no ${assignedLabel}, status not ${terminalLabel}). ` +
		`Optional: ${optionalHint}. ` +
		"Use 'recency', 'since', or 'until' to narrow by creation date."
	);
}

export function buildTicketCountByPeriodDescription(resource: string): string {
	return buildCountByPeriodDescription(resource);
}

export function buildCountByPeriodDescription(resource: string): string {
	const lang = RESOURCE_LANGUAGE_CONFIG[resource];
	const recordsLabel = lang?.label ?? `${resource} records`;
	const optionalHint = lang?.hasPriority
		? "'company', 'status', 'priority' (labels or IDs, auto-resolved)"
		: "'company', 'status' (labels or IDs, auto-resolved)";
	return (
		`Count ${recordsLabel} created within a named time period. Required: 'period' (e.g. 'this_month', 'last_quarter'). ` +
		`Optional: ${optionalHint}. ` +
		"Returns matchCount plus the period date bounds used."
	);
}

export function buildTicketGetBySLAStatusDescription(_resource: string): string {
	return (
		"Filter tickets by SLA state. Required: 'slaStatus' = 'breached' | 'at_risk' | 'compliant'. " +
		"For 'at_risk': tickets whose resolvedDueDateTime is within 'atRiskWindowHours' hours from now (default 4h). " +
		"Optional: 'company' (name or ID, auto-resolved). " +
		"Use 'recency', 'since', or 'until' to narrow by creation date."
	);
}

export function buildTicketGetByAgeDescription(resource: string): string {
	return buildGetByAgeDescription(resource);
}

export function buildGetByAgeDescription(resource: string): string {
	const lang = RESOURCE_LANGUAGE_CONFIG[resource];
	const recordsLabel = lang?.label ?? `${resource} records`;
	const optionalHint = lang?.hasPriority
		? "'status', 'company', 'priority' (labels or IDs, auto-resolved)"
		: "'status', 'company' (labels or IDs, auto-resolved)";
	return (
		`Return ${recordsLabel} created more than N days ago. Required: 'olderThanDays' (positive integer). ` +
		`Optional: ${optionalHint}. ` +
		"Use 'returnAll' for the full set."
	);
}

export function buildTicketGetByResourceDescription(_resource: string): string {
	return (
		"Find tickets where a resource is assigned as primary, secondary, or both. " +
		"Required: 'resourceID' (name, email, or numeric ID — auto-resolved). " +
		"Optional: 'mode' = 'primary' | 'secondary' | 'both' (default 'both'). " +
		"'primary' filters tickets by assignedResourceID only. " +
		"'secondary' queries TicketSecondaryResources by resourceID then fetches matching tickets. " +
		"'both' merges and deduplicates — each ticket includes '_matchedAs' field with 'primary' and/or 'secondary'. " +
		"'limit' applies per branch — combined result may exceed limit when mode='both'. " +
		"Optional: 'recency'/'since'/'until', 'excludeTerminalStatuses' (default true), 'returnAll', 'fields'."
	);
}

export function buildTicketSearchByKeywordDescription(_resource: string): string {
	return (
		"Cross-entity full-text search for tickets by keyword. " +
		"Required: 'keyword' (case-insensitive contains-match). " +
		"Always searches ticket 'title' and 'description'. " +
		"Optional: 'includeNotes'=true to also search TicketNotes.description; 'includeTimeEntries'=true to also search TimeEntries.summaryNotes. " +
		"Each returned ticket gets a 'matchedIn' array (e.g. ['title','notes']) indicating which sources matched. " +
		"Per-stage cap: 200 records. " +
		"Use 'recency', 'since', or 'until' to constrain by date (applied post-merge to merged results; use 'recency_field' to specify which date field). " +
		"Use 'returnAll' for the full deduplicated result set."
	);
}

export function buildConfigurationItemMoveConfigurationItemDescription(
	resourceName: string,
): string {
	return (
		'Clone a configuration item to a different company because companyID cannot be updated in place. ' +
		'Copies CI core fields and optional UDFs, optional CI attachments, optional notes, and optional note attachments. ' +
		'Always writes audit notes and can deactivate the source CI after safety checks. ' +
		'Optionally provide impersonationResourceId so created records (CI, notes, attachments) are attributed to that resource. ' +
		'Optionally set proceedWithoutImpersonationIfDenied (default on); this only applies when impersonationResourceId is set and retries without impersonation if write permissions are denied for the impersonated resource. ' +
		'This operation does not migrate tickets, tasks, projects, contracts, related items, DNS records, or billing-product associations. ' +
		`If field names or expected behaviour are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
	);
}

export function buildContactMoveToCompanyDescription(resourceName: string): string {
	return (
		'Move a contact to another company by cloning the contact record and optional related data. ' +
		'Supports duplicate email safeguards, optional company note and attachment copy, contact group copy, and configurable source/destination audit notes. ' +
		'Supports optional impersonation for write attribution with optional fallback when impersonation is denied. ' +
		`If field names or expected behaviour are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
	);
}

export function buildResourceTransferOwnershipDescription(resourceName: string): string {
	return (
		'Transfer ownership and assignments from a source resource to a receiving resource. ' +
		'Supports companies, opportunities, tickets, tasks, projects, task secondary resources, service call assignments, and appointments. ' +
		'Supports due-window filtering, status filtering, and optional audit notes. ' +
		"Use dueWindowPreset for convenient date ranges, or dueWindowPreset='custom' with dueBeforeCustom for exact cut-offs. " +
		'By default, only open/active-style work is targeted by excluding terminal statuses. ' +
		`If field names or expected behaviour are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
	);
}

export function buildDescribeFieldsDescription(resourceLabel: string): string {
	return (
		`Describe available ${resourceLabel} fields for AI usage. ` +
		`Use mode 'read' for query fields and mode 'write' for create/update fields.`
	);
}

export function buildListPicklistValuesDescription(resourceLabel: string): string {
	return (
		`List picklist values for a specific ${resourceLabel} field. ` +
		`Use this when create or update fails due to invalid picklist values. ` +
		`REQUIRED: 'fieldId' = picklist field name (e.g. 'status', 'priority'). Do NOT pass 'targetOperation' — that belongs to 'describeOperation'.`
	);
}

const TRUNCATION_SUFFIX =
	"...[description truncated — call with operation='describeOperation' and targetOperation='<op>' for operation-specific detail, or operation='describeFields' for field metadata]";

/**
 * Truncate a description to fit within the character budget.
 * Cuts at the last word boundary before the limit and appends a visible truncation suffix
 * so the LLM knows content was removed.
 */
function truncateDescription(text: string, limit = 1300): string {
	if (text.length <= limit) return text;
	const cutAt = Math.max(0, limit - TRUNCATION_SUFFIX.length);
	const lastSpace = text.lastIndexOf(' ', cutAt);
	const breakpoint = lastSpace >= 0 ? lastSpace : cutAt;
	return text.slice(0, breakpoint) + TRUNCATION_SUFFIX;
}

export function buildUnifiedDescription(
	resourceLabel: string,
	resource: string,
	operations: string[],
	readFields: FieldMeta[],
	writeFields: FieldMeta[],
	referenceUtc: string,
	supportsImpersonation: boolean,
): string {
	const template = buildUnifiedDescriptionTemplate(
		resourceLabel,
		resource,
		operations,
		readFields,
		writeFields,
		supportsImpersonation,
	);
	return injectDescriptionReferenceUtc(template, referenceUtc);
}

export function injectDescriptionReferenceUtc(template: string, referenceUtc: string): string {
	return template.split(DESCRIPTION_REFERENCE_PLACEHOLDER).join(referenceUtc);
}

export function buildUnifiedDescriptionTemplate(
	resourceLabel: string,
	resource: string,
	operations: string[],
	readFields: FieldMeta[],
	writeFields: FieldMeta[],
	supportsImpersonation: boolean,
): string {
	const cacheKey = getDescriptionTemplateCacheKey(
		resource,
		operations,
		readFields,
		writeFields,
		supportsImpersonation,
	);
	const cached = descriptionTemplateCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	traceDescriptionBuild({
		phase: 'build-start',
		resource,
		summary: {
			operations,
			readFieldCount: readFields.length,
			writeFieldCount: writeFields.length,
			supportsImpersonation,
		},
	});
	const hasWriteOps = operations.some((op) => isWriteOperation(op));
	const allOps = [
		...new Set([...operations, 'describeFields', 'listPicklistValues', 'describeOperation']),
	];
	const sections: string[] = [];

	// Tool contract block — always first, guaranteed to survive truncation.
	sections.push(buildToolContractBlock());

	// Safety-critical header — always present for write ops.
	if (hasWriteOps) {
		sections.push(
			'WRITE SAFETY: name/reference resolutions must match exactly. Ambiguous or failed resolutions block writes.',
		);
	}

	const aiDescription = getEntityMetadata(resource)?.aiDescription;
	if (aiDescription) {
		sections.push(aiDescription);
	}
	const identityHint = getAiIdentityHint(resource);
	if (identityHint) {
		sections.push(identityHint);
	}
	if (resource === 'company') {
		sections.push(
			"Company identifier priority: domain from email/website first; fall back to companyName contains only when no domain signal.",
		);
	}

	// Operations list — single canonical source of which ops this tool exposes.
	sections.push(`Operations: ${allOps.join(', ')}. Set 'operation' to one.`);
	sections.push(dateTimeReferenceSnippet(DESCRIPTION_REFERENCE_PLACEHOLDER));

	// Helper ops compressed into one line — full per-op detail lives in describeOperation.
	sections.push(
		"For op-specific docs (required fields, params, semantics) call 'describeOperation' (param: targetOperation). " +
		"For field metadata call 'describeFields' (param: mode='read'|'write'). " +
		"For picklist values call 'listPicklistValues' (param: fieldId).",
	);

	if (supportsImpersonation) {
		sections.push("Impersonation supported: pass 'impersonationResourceId' for write attribution.");
	}

	const combined = sections.join(' ');
	const output = truncateDescription(combined);
	setDescriptionTemplateCache(cacheKey, output);
	traceDescriptionBuild({
		phase: 'build-complete',
		resource,
		summary: {
			operationsIncluded: operations,
			writeSafetyHeaderAdded: hasWriteOps,
			identifierPairNoteIncluded: operations.some(
				(op) => op === 'slaHealthCheck' || op === 'summary' || op === 'getFullDetail',
			),
			impersonationNoteIncluded: supportsImpersonation,
			truncationApplied: combined.length !== output.length,
			finalLength: output.length,
			...(AI_TOOL_DEBUG_VERBOSE ? { descriptionPreview: redactForVerbose(output) } : {}),
		},
	});
	return output;
}

// ─── describeOperation builder ───────────────────────────────────────────────

export interface OperationParam {
	field: string;
	type: string;
	target?: string; // for reference fields: referenced entity
	values?: string[]; // for picklist fields with ≤10 values: id=label pairs
	description?: string;
}

export interface OperationDoc {
	operation: string;
	purpose: string;
	parameters: {
		required: OperationParam[];
		optional: OperationParam[];
	};
	notes: string[];
}

const WRITE_OPS_WITH_FIELD_METADATA = new Set(['create', 'update', 'createIfNotExists']);

const LABEL_RESOLUTION_NOTES = [
	'Name-based resolution: picklist and reference fields accept human-readable names (e.g. "Will Spence") — auto-resolved to numeric IDs before writing.',
	"Use operation='describeFields' with mode='write' to discover available field names and types.",
];
const DEDUP_NOTES = [
	'dedupFields: array of field names for duplicate detection. Empty = skip dedup, always create.',
	'errorOnDuplicate: when true, errors on duplicate instead of skipping. Default false.',
	'updateFields: field names to compare against the duplicate — values that differ cause an update. Requires errorOnDuplicate=false.',
	'Returns outcome: created, skipped, updated, or a resource-specific not_found variant.',
];
const LIST_ADVANCED_NOTES = [
	'filtersJson: JSON array of Autotask IFilterCondition objects for 3+ conditions or nested OR. Mutually exclusive with flat filter_field triplets. No label resolution — pass numeric IDs.',
	`returnAll=true: fetches ALL matching records via API-native pagination. Without fields param: capped at ${MAX_RESPONSE_RECORDS} records. With fields param (sparse): no cap — all records returned. Use a narrow fields list for bulk ID/lookup patterns.`,
	ASCENDING_ID_WARNING,
	RECENCY_VS_SINCE_UNTIL_RULE.trim(),
];

const SEARCH_BY_KEYWORD_NOTES: readonly string[] = [
	"Use 'limit' (default 10) or 'returnAll=true' to control result count from the merged set.",
	"Use 'recency', 'since', or 'until' to filter by creation date — applied post-merge, not per-stage.",
	"Per-stage cap is 200 records. If a stage hits the cap, set includeNotes/includeTimeEntries=false or narrow the keyword.",
];

/** Static parameter map for read and metadata operations */
const READ_OP_PARAMS: Record<string, { required: OperationParam[]; optional: OperationParam[] }> = {
	get: {
		required: [{ field: 'id', type: 'number', description: 'Numeric entity ID.' }],
		optional: [
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
		],
	},
	getMany: {
		required: [],
		optional: [
			{ field: 'filter_field', type: 'string', description: 'Field to filter on.' },
			{
				field: 'filter_op',
				type: 'string',
				description:
					'Operator: eq, noteq, gt, gte, lt, lte, contains, beginsWith, endsWith, exist, notExist, in, notIn.',
			},
			{
				field: 'filter_value',
				type: 'string',
				description:
					"Filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3'). Booleans: 'true'/'false'.",
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second filter field.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{
				field: 'filter_value_2',
				type: 'string',
				description:
					"Second filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3').",
			},
			{ field: 'filter_logic', type: 'string', description: "'and' (default) or 'or'." },
			{
				field: 'filtersJson',
				type: 'string',
				description:
					'JSON IFilterCondition array (mutually exclusive with flat filter_field triplets). No label resolution.',
			},
			{
				field: 'returnAll',
				type: 'boolean',
				description:
					`Fetch ALL matching records via API pagination. Without fields: capped at ${MAX_RESPONSE_RECORDS}. With fields (sparse fieldset): cap lifted — all records returned.`,
			},
			{ field: 'limit', type: 'number', description: 'Max records (1-500, default 10).' },
			{ field: 'offset', type: 'number', description: 'Skip first N records (max 499).' },
			{
				field: 'recency',
				type: 'string',
				description: 'Preset window (last_7d, last_30d, etc.) or custom last_Nd.',
			},
			{ field: 'since', type: 'string', description: 'Range start ISO-8601 UTC.' },
			{ field: 'until', type: 'string', description: 'Range end ISO-8601 UTC.' },
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
			{ field: 'outputMode', type: 'string', description: "'idsAndLabels' (default) or 'rawIds'." },
		],
	},
	count: {
		required: [],
		optional: [
			{ field: 'filter_field', type: 'string', description: 'Field to filter on.' },
			{ field: 'filter_op', type: 'string', description: 'Filter operator.' },
			{
				field: 'filter_value',
				type: 'string',
				description:
					"Filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3').",
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second filter field.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{
				field: 'filter_value_2',
				type: 'string',
				description:
					"Second filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3').",
			},
			{ field: 'filter_logic', type: 'string', description: "'and' (default) or 'or'." },
			{ field: 'filtersJson', type: 'string', description: 'JSON IFilterCondition array.' },
			{ field: 'recency', type: 'string', description: 'Preset window.' },
			{ field: 'since', type: 'string', description: 'Range start ISO-8601 UTC.' },
			{ field: 'until', type: 'string', description: 'Range end ISO-8601 UTC.' },
		],
	},
	delete: {
		required: [{ field: 'id', type: 'number', description: 'Numeric entity ID to delete.' }],
		optional: [],
	},
	whoAmI: {
		required: [],
		optional: [
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
		],
	},
	getPosted: {
		required: [],
		optional: [
			{ field: 'filter_field', type: 'string', description: 'Field to filter on.' },
			{ field: 'filter_op', type: 'string', description: 'Filter operator.' },
			{
				field: 'filter_value',
				type: 'string',
				description:
					"Filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3').",
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second field to filter on.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{ field: 'filter_value_2', type: 'string', description: 'Second filter value.' },
			{ field: 'filter_logic', type: 'string', description: "'and' (default) or 'or' — logic between filter pairs." },
			{ field: 'filtersJson', type: 'string', description: 'JSON IFilterCondition array. Mutually exclusive with filter_field.' },
			{ field: 'returnAll', type: 'boolean', description: 'Fetch ALL matching records.' },
			{ field: 'limit', type: 'number', description: 'Max records (1-500, default 10).' },
			{ field: 'recency', type: 'string', description: 'Preset window.' },
			{ field: 'since', type: 'string', description: 'Range start ISO-8601 UTC.' },
			{ field: 'until', type: 'string', description: 'Range end ISO-8601 UTC.' },
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
		],
	},
	getUnposted: {
		required: [],
		optional: [
			{ field: 'filter_field', type: 'string', description: 'Field to filter on.' },
			{ field: 'filter_op', type: 'string', description: 'Filter operator.' },
			{
				field: 'filter_value',
				type: 'string',
				description:
					"Filter value as string. For in/notIn, comma-separate values (e.g. '1,2,3').",
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second field to filter on.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{ field: 'filter_value_2', type: 'string', description: 'Second filter value.' },
			{ field: 'filter_logic', type: 'string', description: "'and' (default) or 'or' — logic between filter pairs." },
			{ field: 'filtersJson', type: 'string', description: 'JSON IFilterCondition array. Mutually exclusive with filter_field.' },
			{ field: 'returnAll', type: 'boolean', description: 'Fetch ALL matching records.' },
			{ field: 'limit', type: 'number', description: 'Max records (1-500, default 10).' },
			{ field: 'recency', type: 'string', description: 'Preset window.' },
			{ field: 'since', type: 'string', description: 'Range start ISO-8601 UTC.' },
			{ field: 'until', type: 'string', description: 'Range end ISO-8601 UTC.' },
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
		],
	},
	searchByDomain: {
		required: [],
		optional: [
			{
				field: 'domain',
				type: 'string',
				description:
					"Domain to search. Prefer domain extracted from email/website first (e.g. email='user@domain.com' -> 'domain.com').",
			},
			{
				field: 'domainOperator',
				type: 'string',
				description:
					"Operator: eq, beginsWith, endsWith, contains (default 'contains'). Do domain matching first; avoid strict exact-name-only matching when a domain exists.",
			},
			{
				field: 'searchContactEmails',
				type: 'boolean',
				description: 'Fall back to contact email search if no website match (default true).',
			},
			{
				field: 'fields',
				type: 'string',
				description: 'Comma-separated company field names to return.',
			},
		],
	},
	searchByIdentity: {
		required: [],
		optional: [
			{
				field: 'companyName',
				type: 'string',
				description: 'Optional company name signal (contains match).',
			},
			{
				field: 'email',
				type: 'string',
				description: 'Optional email signal used to infer domain.',
			},
			{
				field: 'website',
				type: 'string',
				description: 'Optional website/domain signal used for primary match.',
			},
			{
				field: 'limit',
				type: 'number',
				description: 'Max ranked candidates to return (1-100, default 25).',
			},
			{
				field: 'fields',
				type: 'string',
				description: 'Comma-separated company field names to return.',
			},
		],
	},
	slaHealthCheck: {
		required: [],
		optional: [
			{
				field: 'id',
				type: 'number',
				description: 'Numeric Ticket ID (required if ticketNumber not provided).',
			},
			{
				field: 'ticketNumber',
				type: 'string',
				description: 'Ticket number T{date}.{seq} (required if id not provided).',
			},
			{
				field: 'ticketFields',
				type: 'string',
				description: 'Optional comma-separated ticket fields to return.',
			},
		],
	},
	summary: {
		required: [],
		optional: [
			{
				field: 'id',
				type: 'number',
				description: 'Numeric Ticket ID (required if ticketNumber not provided).',
			},
			{
				field: 'ticketNumber',
				type: 'string',
				description: 'Ticket number T{date}.{seq} (required if id not provided).',
			},
			{
				field: 'includeRaw',
				type: 'boolean',
				description: 'Include full enriched pre-alias payload.',
			},
			{
				field: 'summaryTextLimit',
				type: 'number',
				description: 'Max chars for description/resolution fields (default 500, 0=no limit).',
			},
			{
				field: 'includeChildCounts',
				type: 'boolean',
				description: 'Include child entity counts (default false, adds API calls).',
			},
		],
	},
	moveConfigurationItem: {
		required: [
			{ field: 'sourceConfigurationItemId', type: 'number', description: 'Source CI ID to clone.' },
			{ field: 'destinationCompanyId', type: 'number', description: 'Destination company ID.' },
		],
		optional: [
			{
				field: 'destinationCompanyLocationId',
				type: 'number',
				description: 'Optional destination location ID.',
			},
			{ field: 'copyUdfs', type: 'boolean', description: 'Copy UDFs (default true).' },
			{
				field: 'copyAttachments',
				type: 'boolean',
				description: 'Copy CI attachments (default true).',
			},
			{ field: 'copyNotes', type: 'boolean', description: 'Copy notes (default true).' },
			{
				field: 'deactivateSource',
				type: 'boolean',
				description: 'Deactivate source CI after safety checks (default true).',
			},
			{
				field: 'impersonationResourceId',
				type: 'number | string',
				description: 'Resource ID or name for write attribution.',
			},
		],
	},
	moveToCompany: {
		required: [
			{ field: 'sourceContactId', type: 'number', description: 'Source contact ID to move.' },
			{ field: 'destinationCompanyId', type: 'number', description: 'Destination company ID.' },
		],
		optional: [
			{
				field: 'skipIfDuplicateEmailFound',
				type: 'boolean',
				description: 'Skip move on duplicate email (default true).',
			},
			{
				field: 'copyContactGroups',
				type: 'boolean',
				description: 'Copy contact group memberships (default true).',
			},
			{
				field: 'copyCompanyNotes',
				type: 'boolean',
				description: 'Copy company notes linked to contact (default true).',
			},
			{
				field: 'impersonationResourceId',
				type: 'number | string',
				description: 'Resource ID or name for write attribution.',
			},
		],
	},
	transferOwnership: {
		required: [
			{ field: 'sourceResourceId', type: 'number', description: 'Source resource ID.' },
			{
				field: 'destinationResourceId',
				type: 'number',
				description: 'Receiving resource ID (must be active).',
			},
		],
		optional: [
			{ field: 'includeTickets', type: 'boolean', description: 'Include tickets (default false).' },
			{
				field: 'includeProjects',
				type: 'boolean',
				description: 'Include projects (default false).',
			},
			{
				field: 'includeCompanies',
				type: 'boolean',
				description: 'Include companies (default false).',
			},
			{
				field: 'dueWindowPreset',
				type: 'string',
				description:
					"Due window (today, tomorrow, plus7Days, etc. or 'custom' with dueBeforeCustom).",
			},
			{
				field: 'impersonationResourceId',
				type: 'number | string',
				description: 'Resource ID or name for write attribution.',
			},
		],
	},
	getAvailableRoles: {
		required: [
			{ field: 'resourceID', type: 'number | string', description: 'Resource name, email, or numeric ID (auto-resolved). Required.' },
		],
		optional: [
			{ field: 'ticketID', type: 'number', description: 'Ticket ID. If provided, derives queueID and contractID automatically.' },
			{ field: 'queueID', type: 'number', description: 'Queue ID to filter roles by.' },
			{ field: 'contractID', type: 'number', description: 'Contract ID to apply exclusion rules.' },
		],
	},
	getByResource: {
		required: [
			{ field: 'resourceID', type: 'number | string', description: 'Resource name, email, or numeric ID (auto-resolved).' },
		],
		optional: [
			{ field: 'mode', type: 'string', description: "ticket only: 'primary' | 'secondary' | 'both' (default 'both')." },
			{ field: 'limit', type: 'number', description: 'Max records per branch (1-500, default 10).' },
			{ field: 'returnAll', type: 'boolean', description: 'Fetch all per branch.' },
			{ field: 'recency', type: 'string', description: 'Preset window (e.g. last_7d).' },
			{ field: 'since', type: 'string', description: 'Range start ISO-8601 UTC.' },
			{ field: 'until', type: 'string', description: 'Range end ISO-8601 UTC.' },
			{ field: 'excludeTerminalStatuses', type: 'boolean', description: 'Exclude Complete/Cancelled (ticket only, default true).' },
			{ field: 'fields', type: 'string', description: 'Comma-separated field names to return.' },
		],
	},
	getByYear: {
		required: [
			{
				field: 'resourceID',
				type: 'number | string',
				description: 'Resource ID or name (auto-resolved).',
			},
			{ field: 'year', type: 'number', description: 'Calendar year (e.g. 2024).' },
		],
		optional: [],
	},
	approve: {
		required: [{ field: 'id', type: 'number', description: 'Numeric entity ID to approve.' }],
		optional: [],
	},
	reject: {
		required: [{ field: 'id', type: 'number', description: 'Numeric entity ID to reject.' }],
		optional: [
			{
				field: 'rejectReason',
				type: 'string',
				description: 'Reason for rejection (recommended for audit trail).',
			},
		],
	},
	describeFields: {
		required: [],
		optional: [
			{ field: 'mode', type: 'string', description: "'read' or 'write'. Defaults to 'read'." },
		],
	},
	listPicklistValues: {
		required: [
			{ field: 'fieldId', type: 'string', description: 'Field ID to list picklist values for.' },
		],
		optional: [
			{ field: 'query', type: 'string', description: 'Optional search term.' },
			{ field: 'limit', type: 'number', description: 'Max results (default 50).' },
			{ field: 'page', type: 'number', description: 'Page number (default 1).' },
		],
	},
	describeOperation: {
		required: [
			{ field: 'targetOperation', type: 'string', description: 'Operation name to document.' },
		],
		optional: [],
	},
};

function buildWriteParams(
	writeFields: FieldMeta[],
	includeDedup = false,
): { required: OperationParam[]; optional: OperationParam[] } {
	const required: OperationParam[] = [];
	const optional: OperationParam[] = [];
	for (const field of writeFields) {
		if (field.id === 'id') continue;
		const param: OperationParam = { field: field.id, type: field.type ?? 'string' };
		if (field.isReference && field.referencesEntity) {
			param.type = 'reference';
			param.target = field.referencesEntity;
		} else if (field.isPickList && field.allowedValues?.length) {
			param.type = 'picklist';
			if (field.allowedValues.length <= 10) {
				param.values = field.allowedValues.map((v) => `${v.id}=${v.label}`);
			} else {
				param.description = `${field.allowedValues.length} values — use listPicklistValues`;
			}
		}
		if (field.required) {
			required.push(param);
		} else {
			optional.push(param);
		}
	}
	if (includeDedup) {
		optional.push(
			{
				field: 'dedupFields',
				type: 'string[]',
				description: 'Field names for duplicate detection.',
			},
			{
				field: 'errorOnDuplicate',
				type: 'boolean',
				description: 'Error on duplicate instead of skipping (default false).',
			},
			{
				field: 'updateFields',
				type: 'string[]',
				description: 'Field names to update when duplicate value differs.',
			},
		);
	}
	optional.push(
		{
			field: 'impersonationResourceId',
			type: 'number | string',
			description: 'Resource ID or name for write attribution (auto-resolved).',
		},
	);
	return { required, optional };
}

function getOperationPurpose(
	resource: string,
	resourceLabel: string,
	operation: string,
	readFields: FieldMeta[],
	writeFields: FieldMeta[],
): string {
	switch (operation) {
		case 'get':
			return buildGetDescription(resourceLabel, resource);
		case 'getMany':
			return buildGetManyDescription(
				resourceLabel,
				resource,
				readFields,
				RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION.has(resource)
					? (RESOURCE_LANGUAGE_CONFIG[resource]?.terminalStatusLabel ?? undefined)
					: undefined,
			);
		case 'count':
			return buildCountDescription(resourceLabel);
		case 'create':
			return buildCreateDescription(resourceLabel, resource, writeFields);
		case 'update':
			return buildUpdateDescription(resourceLabel, resource, writeFields);
		case 'delete':
			return buildDeleteDescription(resourceLabel, resource);
		case 'whoAmI':
			return buildWhoAmIDescription(resourceLabel);
		case 'getPosted':
			return buildPostedTimeEntriesDescription(resource);
		case 'getUnposted':
			return buildUnpostedTimeEntriesDescription(resource);
		case 'searchByDomain':
			return buildCompanySearchByDomainDescription(resource);
		case 'searchByIdentity':
			return buildCompanySearchByIdentityDescription(resource);
		case 'slaHealthCheck':
			return buildTicketSlaHealthCheckDescription(resource);
		case 'summary':
			return buildTicketSummaryDescription(resource);
		case 'timeline':
			return buildTicketTimelineDescription(resource);
		case 'getFullDetail':
			return buildGetFullDetailDescription(resource);
		case 'countByPeriod':
			return buildCountByPeriodDescription(resource);
		case 'getByAge':
			return buildGetByAgeDescription(resource);
		case 'searchByKeyword':
			return buildTicketSearchByKeywordDescription(resource);
		case 'getByCompanyAndStatus':
			return buildGetByCompanyAndStatusDescription(resource);
		case 'getUnassigned':
			return buildGetUnassignedDescription(resource);
		case 'getBySLAStatus':
			return buildTicketGetBySLAStatusDescription(resource);
		case 'moveConfigurationItem':
			return buildConfigurationItemMoveConfigurationItemDescription(resource);
		case 'moveToCompany':
			return buildContactMoveToCompanyDescription(resource);
		case 'transferOwnership':
			return buildResourceTransferOwnershipDescription(resource);
		case 'createIfNotExists': {
			const extraHint = RESOURCE_EXTRA_HINTS[resource] ?? '';
			return `Idempotent creation for ${resourceLabel}: checks for duplicates using dedupFields before creating. Returns outcome: created, skipped, updated, or a resource-specific not_found variant.` +
				(extraHint ? ` ${extraHint}` : '');
		}
		case 'getAvailableRoles':
			return `Return active roles available for a resource on a specific queue/contract. Required: resourceID. Optional: ticketID (auto-derives queueID and contractID), queueID, contractID. Contract exclusion rules are applied — returned roles are safe to use for time entry creation on that contract. Each role includes roleName and roleDescription; suggestedDefault is flagged when derivable from ticket assignment.`;
		case 'getByResource':
			if (resource === 'ticket') return buildTicketGetByResourceDescription(resource);
			return `Get ${resourceLabel} record(s) for a specific resource. Provide resourceID as a name or numeric ID (auto-resolved).`;
		case 'getByYear':
			return `Get the time-off balance for a specific calendar year. Provide resourceID (name or ID) and year as an integer.`;
		case 'approve':
			return `Approve a pending ${resourceLabel} request by numeric ID.`;
		case 'reject':
			return `Reject a pending ${resourceLabel} request by numeric ID. Provide an optional rejectReason string.`;
		case 'describeFields':
			return buildDescribeFieldsDescription(resourceLabel);
		case 'listPicklistValues':
			return buildListPicklistValuesDescription(resourceLabel);
		case 'describeOperation':
			return `Returns full documentation for a specific ${resourceLabel} operation — purpose, parameters, and usage notes.`;
		case 'searchNotes':
			return buildGlobalNotesSearchDescription();
		default:
			return `Perform ${operation} on ${resourceLabel} records.`;
	}
}

export function buildGlobalNotesSearchDescription(): string {
	return [
		'Search notes across all 7 Autotask entity types simultaneously: tickets, companies, projects, tasks, contracts, configuration items, and products.',
		'',
		'PARAMETERS:',
		'  keyword — search note title and body text (contains match)',
		'  since (ISO 8601) — lower bound on createDateTime',
		'  until (ISO 8601) — upper bound on createDateTime',
		'  limit (1–25, default 10) — max results per entity type; max total = 7 × limit',
		'',
		'At least one of keyword, since, or until is required.',
		'',
		'RESPONSE: flat records[] each with entityType field, groupCounts summary per entity,',
		'truncatedEntities[] when results hit the per-type cap.',
	].join('\n');
}

function getOperationNotes(resource: string, operation: string): string[] {
	const contractNotes = getOperationContractRuleText(resource, operation);
	switch (operation) {
		case 'create':
		case 'update':
			return [...contractNotes, ...LABEL_RESOLUTION_NOTES];
		case 'createIfNotExists':
			return [...contractNotes, ...LABEL_RESOLUTION_NOTES, ...DEDUP_NOTES];
		case 'slaHealthCheck':
		case 'summary':
		case 'timeline':
		case 'getFullDetail':
		case 'countByPeriod':
			return [...contractNotes];
		case 'searchByKeyword':
			return [...contractNotes, ...SEARCH_BY_KEYWORD_NOTES];
		case 'getByAge':
		case 'getByCompanyAndStatus':
		case 'getUnassigned':
		case 'getBySLAStatus':
		case 'getByResource':
			return [...contractNotes, ...LIST_ADVANCED_NOTES];
		case 'getMany':
		case 'getPosted':
		case 'getUnposted':
			return [...contractNotes, ...LIST_ADVANCED_NOTES];
		default:
			return [...contractNotes];
	}
}

/**
 * Build operation documentation for the describeOperation helper.
 * Returns purpose (from existing description builders), parameters (from field metadata
 * for write ops; static for read/metadata ops), and usage notes.
 */
export function buildOperationDoc(
	resource: string,
	targetOperation: string,
	readFields: FieldMeta[],
	writeFields: FieldMeta[],
): OperationDoc {
	const resourceLabel = resource.charAt(0).toUpperCase() + resource.slice(1);
	const purpose = getOperationPurpose(
		resource,
		resourceLabel,
		targetOperation,
		readFields,
		writeFields,
	);

	let parameters: { required: OperationParam[]; optional: OperationParam[] };
	if (WRITE_OPS_WITH_FIELD_METADATA.has(targetOperation)) {
		parameters = buildWriteParams(writeFields, targetOperation === 'createIfNotExists');
	} else {
		parameters = READ_OP_PARAMS[targetOperation] ?? { required: [], optional: [] };
	}

	const notes = getOperationNotes(resource, targetOperation);
	return { operation: targetOperation, purpose, parameters, notes };
}
