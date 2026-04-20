import type { FieldMeta } from '../helpers/aiHelper';
import { getEntityMetadata } from '../constants/entities';
import { getAiIdentityHint } from '../constants/ai-identity';
import { AI_TOOL_DEBUG_VERBOSE, redactForVerbose, traceDescriptionBuild } from './debug-trace';
import { getOperationContractRuleText } from './operation-contracts';
import { getOperationMetadata, isWriteOperation } from './operation-metadata';

export const DESCRIPTION_REFERENCE_PLACEHOLDER = '__REFERENCE_UTC__';

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
	return `Reference: current UTC date-time when these tools were loaded is ${referenceUtc}. Use this for "today", "recent", or when choosing since/until or recency — do not assume a different date. `;
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
	'Date filtering: use EITHER recency OR since/until, not both. If you provide since or until, recency is ignored (since/until take precedence). Use recency for preset windows (e.g. last_7d, last_30d) or custom days as last_Nd with N from 1 to 365 (e.g. last_5d, last_45d) to limit how far back to look. Use since/until only when you need an explicit UTC range. ';

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
	referenceUtc?: string,
): string {
	const fieldList = listFilterableFields(readFields);
	const dateFieldHint = listDateTimeFieldHint(readFields);
	const ref = referenceUtc
		? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE
		: '';

	return (
		ref +
		`Search ${resourceLabel} records with up to two filters (AND by default; set filter_logic='or' for either-match). ` +
		`Example: filter_field='companyName', filter_op='contains', filter_value='Acme'. ` +
		`Use filter_value as true/false for boolean fields, and use arrays (or comma-separated values) for in/notIn operators. ` +
		`Use exist/notExist operators (no filter_value needed) to filter by non-null/null — e.g., filter_op='exist' returns records where the field is populated, filter_op='notExist' returns records where it is null. Essential for narrowing results to records linked to a specific parent entity. ` +
		`UDF filtering supports one UDF field per query. ` +
		`Filterable fields include: ${fieldList}. ` +
		`IMPORTANT: The Autotask API always returns records in ascending ID order (oldest first). Without recency or since, limit=1 returns the OLDEST record, not the newest. ` +
		`To get the most recent or latest records, you MUST use recency (for example 'last_7d') or provide since/until in ISO-8601 UTC format (for example 2026-01-01T00:00:00Z). ` +
		`When recency or since is used, the tool automatically filters by date, fetches a wide window, and returns the newest records first, trimmed to limit. ` +
		`If results are unexpectedly empty, check API user security permissions before retrying. ` +
		`Name-based filter resolution: for reference and picklist filter fields, you can pass a human-readable name as filter_value (e.g. filter_field='companyID', filter_value='Contoso') — the tool auto-resolves names to IDs. ` +
		`${ASCENDING_ID_WARNING} ` +
		dateFieldHint +
		`For all matching records, use returnAll=true with a tight filter. ` +
		`For complex filters (3+ conditions, nested OR/IN), use filtersJson with the Autotask IFilterCondition JSON array. ` +
		`Always provide at least one filter when possible. ` +
		describeFieldsHint(resourceName)
	);
}

export function buildCountDescription(resourceLabel: string, referenceUtc?: string): string {
	const ref = referenceUtc
		? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE
		: '';
	return (
		ref +
		`Count ${resourceLabel} records matching optional filters. ` +
		`Use the same filter parameters as getMany and return only the count. ` +
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
				info += ` [${field.allowedValues.length} values — call listPicklistValues for full list]`;
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
	supportsImpersonation = false,
	referenceUtc?: string,
): string {
	const requiredSummary = buildRequiredFieldsSummary(writeFields);
	const parentField = getParentRequirement(resourceName);
	const parentHint = parentField ? ` Parent relation required: include ${parentField}.` : '';
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	const impersonationNote = supportsImpersonation
		? ' Optional impersonation is supported with impersonationResourceId (accepts name or ID). Impersonation is off by default unless that value is set. If proceedWithoutImpersonationIfDenied is true, denied impersonated writes retry once without impersonation.'
		: '';

	return (
		ref +
		`Create a new ${resourceLabel} record. ` +
		`${requiredSummary}${parentHint} ` +
		`Name-based resolution: you can pass human-readable names instead of numeric IDs for picklist and reference fields (e.g. resourceName "Will Spence" instead of resourceID 29683, or category name "Internal Meeting" instead of numeric billingCodeID). The tool auto-resolves names to IDs. ` +
		`Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
		`Successful creates typically return an itemId and any resolvedLabels showing name→ID mappings. ` +
		`Confirm field values with user before executing when acting autonomously. ` +
		`If picklist values fail validation, call autotask_${resourceName} with operation 'listPicklistValues'.` +
		impersonationNote
	);
}

export function buildUpdateDescription(
	resourceLabel: string,
	resourceName: string,
	supportsImpersonation = false,
	referenceUtc?: string,
): string {
	const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) : '';
	const impersonationNote = supportsImpersonation
		? ' Optional impersonation is supported with impersonationResourceId (accepts name or ID). Impersonation is off by default unless that value is set. If proceedWithoutImpersonationIfDenied is true, denied impersonated writes retry once without impersonation.'
		: '';
	return (
		ref +
		`Update an existing ${resourceLabel} record by numeric ID. ` +
		`PREREQUISITE: you need the numeric ID. If you only have a name or text, call autotask_${resourceName} with operation 'getMany' with a filter to find the record and get its 'id' first. ` +
		`Only provide fields to change (PATCH-style behaviour). ` +
		`Do not assume PUT-style replacement where omitted fields become null. ` +
		`Name-based resolution: you can pass human-readable names instead of numeric IDs for picklist and reference fields. The tool auto-resolves names to IDs. ` +
		`Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
		`Confirm field values with user before executing when acting autonomously. ` +
		`${describeFieldsHint(resourceName, 'write')} ` +
		`Use autotask_${resourceName} with operation 'listPicklistValues' for picklist fields.` +
		impersonationNote
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
	const ref = referenceUtc
		? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE
		: '';
	return (
		ref +
		`Get posted time entries (entries with matching Billing Items). ` +
		`Supports the same optional filters as getMany (up to two filters, AND by default; set filter_logic='or' for either-match), plus 'limit', 'offset', and 'fields'. ` +
		`IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
		`To get the most recent posted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
		`For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
		describeFieldsHint(resourceName)
	);
}

export function buildUnpostedTimeEntriesDescription(
	resourceName: string,
	referenceUtc?: string,
): string {
	const ref = referenceUtc
		? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE
		: '';
	return (
		ref +
		`Get unposted time entries (entries without matching Billing Items). ` +
		`Supports the same optional filters as getMany (up to two filters, AND by default; set filter_logic='or' for either-match), plus 'limit', 'offset', and 'fields'. ` +
		`IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
		`To get the most recent unposted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
		`For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
		describeFieldsHint(resourceName)
	);
}

export function buildCompanySearchByDomainDescription(resourceName: string): string {
	return (
		'Search companies by domain using website-style fields. ' +
		'Input can be a bare domain or full URL; the tool normalises it to a domain fragment (for example autotask.net). ' +
		'IMPORTANT: Autotask typically stores company websites as full URLs (for example https://www.autotask.net/), so exact operator matches can fail on bare domain input. ' +
		'To avoid false negatives, eq/like semantics are handled safely for website matching. ' +
		'When searchContactEmails is true (default), if no company website matches exist, the tool searches Contact.emailAddress by domain and resolves the most common canonical company name from companyID references. ' +
		"Use the 'fields' parameter to limit which company fields are returned per result (comma-separated); omit to receive the full company entity. matchedField and matchedValue are always included to indicate which website field matched and its value. " +
		describeFieldsHint(resourceName)
	);
}

export function buildTicketSummaryDescription(resourceName: string): string {
	const ruleText = getOperationContractRuleText(resourceName, 'summary');
	const identifierRule = ruleText.length > 0 ? `${ruleText.join(' ')} ` : '';
	return (
		'Get a compact, type-aware summary of any Autotask ticket. ' +
		identifierRule +
		'Automatically detects ticket type (Service Request, Incident, Problem, Change Request, Alert) and prioritises the most relevant fields. ' +
		'Filters out null and empty fields to reduce noise. ' +
		"Includes a 'computed' block with pre-calculated values: ageHours, daysSinceLastActivity, isAssigned; for open tickets: isOverdue, plus hoursUntilDue (not yet overdue) or hoursOverdue (past due); when SLA is assigned: slaStatus, slaNextMilestoneDueHours, slaEarliestBreachHours. " +
		"Optionally includes a 'childCounts' block with counts of: notes, timeEntries, attachments, additionalConfigurationItems, additionalContacts, checklistItems (with completed/remaining breakdown), and changeRequestLinks (Change Request tickets only). Set 'includeChildCounts=true' to fetch these counts (adds several parallel API calls; omitted by default). " +
		"Includes a 'relationships' block when the ticket is linked to a project, problem ticket, or opportunity. " +
		"Use 'summaryTextLimit' to cap description/resolution length (default 500 chars). " +
		"Set 'includeRaw=true' to receive the full enriched payload before alias renaming — label/UDF enrichments intact, original changeInfoField{N} keys, no null filtering or text truncation. " +
		'For full SLA milestone timing and elapsed hours, use slaHealthCheck instead. ' +
		describeFieldsHint(resourceName)
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
		describeFieldsHint(resourceName)
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

function buildCreateIfNotExistsDescription(resource: string): string {
	return `Idempotent create for ${resource} using dedupFields (array of API field names); optional updateFields for upsert; errorOnDuplicate (default false). Pass same fields as create. Outcomes: created, skipped, updated.`;
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
		`Use this when create or update fails due to invalid picklist values.`
	);
}

const TRUNCATION_SUFFIX =
	"...[description truncated — call with operation='describeOperation' and targetOperation='<op>' for operation-specific detail, or operation='describeFields' for field metadata]";

/**
 * Truncate a description to fit within the character budget.
 * Cuts at the last word boundary before the limit and appends a visible truncation suffix
 * so the LLM knows content was removed.
 */
function truncateDescription(text: string, limit = 2000): string {
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

	// Safety-critical header — always first, guaranteed to survive truncation
	if (hasWriteOps) {
		sections.push(
			'WRITE SAFETY: All write operations require field references to resolve exactly.' +
				' Ambiguous, unmatched, or infrastructure-failed resolutions block execution before any mutation occurs.',
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
	sections.push(
		`Perform operations on Autotask ${resourceLabel} records.`,
		`Required: 'operation' field — one of: ${allOps.join(', ')}.`,
		dateTimeReferenceSnippet(DESCRIPTION_REFERENCE_PLACEHOLDER),
	);

	for (const op of operations) {
		const metadata = getOperationMetadata(op);
		let summary = metadata
			? `operation '${op}': ${metadata.docsFragment}`
			: `operation '${op}': Perform ${op} on ${resourceLabel}.`;

		if (op === 'whoAmI') {
			summary = `operation '${op}': Resolve the authenticated ${resourceLabel} record.`;
		} else if (op === 'create') {
			summary = `operation '${op}': ${metadata?.docsFragment ?? 'Create a new record.'} ${buildRequiredFieldsSummary(writeFields)}`;
		} else if (op === 'update') {
			if (resource === 'resourceTimeOffAdditional') {
				summary = `operation '${op}': Update time-off additional quotas for a resource. Provide 'resourceID' (name or numeric ID, auto-resolved) and the fields to change (annual/additional hours per category).`;
			} else {
				summary = `operation '${op}': ${metadata?.docsFragment ?? "Update a record by numeric 'id'."}`;
			}
		} else if (op === 'createIfNotExists') {
			summary = `operation '${op}': ${buildCreateIfNotExistsDescription(resource)}`;
		} else if (op === 'getMany') {
			summary = `operation '${op}': ${metadata?.docsFragment ?? ''}`.trim();
		}
		sections.push(summary);
	}

	sections.push(
		`Name-based resolution (create/update/filters): picklist/reference values accept human-readable names, auto-resolved to IDs.`,
	);
	sections.push(
		`operation 'describeFields': List all field IDs, types, and metadata. Use mode 'read' or 'write'.`,
	);
	sections.push(
		`operation 'listPicklistValues': Get valid values for a picklist field. Use 'fieldId' parameter.`,
	);
	sections.push(
		`operation 'describeOperation': Get full documentation for a specific operation — purpose, parameters, and usage notes. Use 'targetOperation' parameter.`,
	);

	if (supportsImpersonation) {
		sections.push(`Impersonation supported: pass 'impersonationResourceId' for write attribution.`);
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
				(op) => op === 'slaHealthCheck' || op === 'summary',
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
	'returnAll=true: fetches ALL matching records via API-native pagination. Response truncated at 100 records — use fields param to reduce payload or narrow filters.',
	ASCENDING_ID_WARNING,
	RECENCY_VS_SINCE_UNTIL_RULE.trim(),
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
				type: 'string | number | boolean | array',
				description: 'Filter value. Use arrays for in/notIn.',
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second filter field.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{
				field: 'filter_value_2',
				type: 'string | number | boolean | array',
				description: 'Second filter value.',
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
					'Fetch ALL matching records via API pagination. Response capped at 100 records.',
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
				type: 'string | number | boolean | array',
				description: 'Filter value.',
			},
			{ field: 'filter_field_2', type: 'string', description: 'Second filter field.' },
			{ field: 'filter_op_2', type: 'string', description: 'Second filter operator.' },
			{
				field: 'filter_value_2',
				type: 'string | number | boolean | array',
				description: 'Second filter value.',
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
				type: 'string | number | boolean | array',
				description: 'Filter value.',
			},
			{ field: 'filtersJson', type: 'string', description: 'JSON IFilterCondition array.' },
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
				type: 'string | number | boolean | array',
				description: 'Filter value.',
			},
			{ field: 'filtersJson', type: 'string', description: 'JSON IFilterCondition array.' },
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
			{ field: 'domain', type: 'string', description: 'Domain to search, e.g. autotask.net.' },
			{
				field: 'domainOperator',
				type: 'string',
				description: "Operator: eq, beginsWith, endsWith, contains (default 'contains').",
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
	getByResource: {
		required: [
			{
				field: 'resourceID',
				type: 'number | string',
				description: 'Resource ID or name (auto-resolved).',
			},
		],
		optional: [
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
			return buildGetManyDescription(resourceLabel, resource, readFields);
		case 'count':
			return buildCountDescription(resourceLabel);
		case 'create':
			return buildCreateDescription(resourceLabel, resource, writeFields, false);
		case 'update':
			return buildUpdateDescription(resourceLabel, resource, false);
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
		case 'slaHealthCheck':
			return buildTicketSlaHealthCheckDescription(resource);
		case 'summary':
			return buildTicketSummaryDescription(resource);
		case 'moveConfigurationItem':
			return buildConfigurationItemMoveConfigurationItemDescription(resource);
		case 'moveToCompany':
			return buildContactMoveToCompanyDescription(resource);
		case 'transferOwnership':
			return buildResourceTransferOwnershipDescription(resource);
		case 'createIfNotExists':
			return `Idempotent creation for ${resourceLabel}: checks for duplicates using dedupFields before creating. Returns outcome: created, skipped, updated, or a resource-specific not_found variant.`;
		case 'getByResource':
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
		default:
			return `Perform ${operation} on ${resourceLabel} records.`;
	}
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
			return [...contractNotes];
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
