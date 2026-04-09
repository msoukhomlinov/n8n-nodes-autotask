import type { FieldMeta } from '../helpers/aiHelper';
import { getEntityMetadata } from '../constants/entities';

function listFilterableFields(readFields: FieldMeta[], max = 12): string {
    return readFields
        .filter((field) => !field.udf)
        .slice(0, max)
        .map((field) => field.id)
        .join(', ');
}

function getParentRequirement(resourceName: string): string | null {
    const metadata = getEntityMetadata(resourceName);
    return metadata?.parentIdField ?? null;
}

/** Snippet injected into tool descriptions that reference date/time so the AI uses actual "now" instead of training cutoff. */
export function dateTimeReferenceSnippet(referenceUtc: string): string {
    return `Reference: current UTC date-time when these tools were loaded is ${referenceUtc}. Use this for "today", "recent", or when choosing since/until or recency — do not assume a different date. `;
}

/** Rule for getMany/count/getPosted/getUnposted: how recency and since/until interact. */
const RECENCY_VS_SINCE_UNTIL_RULE =
    'Date filtering: use EITHER recency OR since/until, not both. If you provide since or until, recency is ignored (since/until take precedence). Use recency for preset windows (e.g. last_7d, last_30d) or custom days as last_Nd with N from 1 to 365 (e.g. last_5d, last_45d) to limit how far back to look. Use since/until only when you need an explicit UTC range. ';

export function buildGetDescription(resourceLabel: string, resourceName: string): string {
    return (
        `Retrieve a single ${resourceLabel} record by numeric ID. ` +
        `ONLY call this when you already have a numeric ID — never pass a name or text. ` +
        `If you only have a name or description, call autotask_${resourceName} with operation 'getMany' with a filter first, extract the 'id' from results, then call this. ` +
        `Optionally use 'fields' to return only selected columns. ` +
        `If a record should exist but response is empty, verify API user permissions (including line-of-business access). ` +
        `Do not guess field names. Call autotask_${resourceName} with operation 'describeFields' (mode 'read') first when unsure.`
    );
}

export function buildGetManyDescription(
    resourceLabel: string,
    resourceName: string,
    readFields: FieldMeta[],
    referenceUtc?: string,
): string {
    const fieldList = listFilterableFields(readFields);
    const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE : '';

    return (
        ref +
        `Search ${resourceLabel} records with up to two filters (AND by default; set filter_logic='or' for either-match). ` +
        `Example: filter_field='companyName', filter_op='contains', filter_value='Acme'. ` +
        `Use filter_value as true/false for boolean fields, and use arrays (or comma-separated values) for in/notIn operators. ` +
        `UDF filtering supports one UDF field per query. ` +
        `Filterable fields include: ${fieldList}. ` +
        `IMPORTANT: The Autotask API always returns records in ascending ID order (oldest first). Without recency or since, limit=1 returns the OLDEST record, not the newest. ` +
        `To get the most recent or latest records, you MUST use recency (for example 'last_7d') or provide since/until in ISO-8601 UTC format (for example 2026-01-01T00:00:00Z). ` +
        `When recency or since is used, the tool automatically filters by date, fetches a wide window, and returns the newest records first, trimmed to limit. ` +
        `If results are unexpectedly empty, check API user security permissions before retrying. ` +
        `Pagination: use 'offset' to skip records (response includes hasMore and nextOffset). ` +
        `Name-based filter resolution: for reference and picklist filter fields, you can pass a human-readable name as filter_value (e.g. filter_field='companyID', filter_value='Contoso') — the tool auto-resolves names to IDs. ` +
        `Always provide at least one filter when possible. ` +
        `If you are unsure about field names, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildCountDescription(resourceLabel: string, referenceUtc?: string): string {
    const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE : '';
    return (
        ref +
        `Count ${resourceLabel} records matching optional filters. ` +
        `Use the same filter parameters as getMany and return only the count. ` +
        `For efficient polling-style checks, prefer LastModifiedDate or LastActivityDate filters where available.`
    );
}

/** Max number of picklist values to inline in the required-fields summary */
const MAX_INLINE_REQUIRED_PICKLIST = 10;

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
                info += ` (picklist, ${field.allowedValues.length} values — use listPicklistValues)`;
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
    const parentHint = parentField
        ? ` Parent relation required: include ${parentField}.`
        : '';
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
        `Call autotask_${resourceName} with operation 'describeFields' (mode 'write') to verify valid field names and required value types. ` +
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

export function buildPostedTimeEntriesDescription(resourceName: string, referenceUtc?: string): string {
    const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE : '';
    return (
        ref +
        `Get posted time entries (entries with matching Billing Items). ` +
        `Supports the same optional filters as getMany (up to two filters, AND by default; set filter_logic='or' for either-match), plus 'limit', 'offset', and 'fields'. ` +
        `IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
        `To get the most recent posted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
        `For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
        `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildUnpostedTimeEntriesDescription(resourceName: string, referenceUtc?: string): string {
    const ref = referenceUtc ? dateTimeReferenceSnippet(referenceUtc) + RECENCY_VS_SINCE_UNTIL_RULE : '';
    return (
        ref +
        `Get unposted time entries (entries without matching Billing Items). ` +
        `Supports the same optional filters as getMany (up to two filters, AND by default; set filter_logic='or' for either-match), plus 'limit', 'offset', and 'fields'. ` +
        `IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
        `To get the most recent unposted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
        `For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
        `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildCompanySearchByDomainDescription(resourceName: string): string {
    return (
        'Search companies by domain using website-style fields. ' +
        "Input can be a bare domain or full URL; the tool normalises it to a domain fragment (for example autotask.net). " +
        "IMPORTANT: Autotask typically stores company websites as full URLs (for example https://www.autotask.net/), so exact operator matches can fail on bare domain input. " +
        "To avoid false negatives, eq/like semantics are handled safely for website matching. " +
        "When searchContactEmails is true (default), if no company website matches exist, the tool searches Contact.emailAddress by domain and resolves the most common canonical company name from companyID references. " +
        "Use the 'fields' parameter to limit which company fields are returned per result (comma-separated); omit to receive the full company entity. matchedField and matchedValue are always included to indicate which website field matched and its value. " +
        `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildTicketSummaryDescription(resourceName: string): string {
    return (
        'Get a compact, type-aware summary of any Autotask ticket. ' +
        `Requires 'id' (numeric Ticket ID) or 'ticketNumber' (format T{date}.{seq}, e.g. T20240615.0001) — calls with neither identifier are rejected immediately. ` +
        'Automatically detects ticket type (Service Request, Incident, Problem, Change Request, Alert) and prioritises the most relevant fields. ' +
        'Filters out null and empty fields to reduce noise. ' +
        "Includes a 'computed' block with pre-calculated values: ageHours, daysSinceLastActivity, isAssigned; for open tickets: isOverdue, plus hoursUntilDue (not yet overdue) or hoursOverdue (past due); when SLA is assigned: slaStatus, slaNextMilestoneDueHours, slaEarliestBreachHours. " +
        "Optionally includes a 'childCounts' block with counts of: notes, timeEntries, attachments, additionalConfigurationItems, additionalContacts, checklistItems (with completed/remaining breakdown), and changeRequestLinks (Change Request tickets only). Set 'includeChildCounts=true' to fetch these counts (adds several parallel API calls; omitted by default). " +
        "Includes a 'relationships' block when the ticket is linked to a project, problem ticket, or opportunity. " +
        "Use 'summaryTextLimit' to cap description/resolution length (default 500 chars). " +
        "Set 'includeRaw=true' to receive the full enriched payload before alias renaming — label/UDF enrichments intact, original changeInfoField{N} keys, no null filtering or text truncation. " +
        "For full SLA milestone timing and elapsed hours, use slaHealthCheck instead. " +
        `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildTicketSlaHealthCheckDescription(resourceName: string): string {
    return (
        `Run an SLA health check on a ticket — provide either 'id' (numeric Ticket ID) or 'ticketNumber' (format T{date}.{seq}, e.g. T20240615.0001); calls with neither identifier are rejected immediately. ` +
        'Returns first-response, resolution-plan, and resolution milestone timing and status in consistent hours (2 decimal places). ' +
        "Use 'ticketFields' to limit which ticket fields are returned in the ticket section. " +
        'Includes wallClockRemainingHours, where negative values indicate overdue milestones. ' +
        'This operation combines data from Ticket and ServiceLevelAgreementResults entities. ' +
        `If field names are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildConfigurationItemMoveConfigurationItemDescription(resourceName: string): string {
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
        'Supports dry run planning which returns source contact details, the destination payload, location resolution, duplicate check result, and planned counts without writing. ' +
        'Supports optional impersonation for write attribution with optional fallback when impersonation is denied. ' +
        `If field names or expected behaviour are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

export function buildResourceTransferOwnershipDescription(resourceName: string): string {
    return (
        'Transfer ownership and assignments from a source resource to a receiving resource. ' +
        'Supports companies, opportunities, tickets, tasks, projects, task secondary resources, service call assignments, and appointments. ' +
        'Supports dry run planning, due-window filtering, status filtering, and optional audit notes. ' +
        'Dry run returns full item lists per entity type with key identifying fields (e.g. id, title, status) plus source/destination resource context. ' +
        "Use dueWindowPreset for convenient date ranges, or dueWindowPreset='custom' with dueBeforeCustom for exact cut-offs. " +
        "By default, only open/active-style work is targeted by excluding terminal statuses. " +
        `If field names or expected behaviour are uncertain, call autotask_${resourceName} with operation 'describeFields' first.`
    );
}

function buildCreateIfNotExistsDescription(resource: string): string {
	return `Idempotent creation for ${resource}. Checks for duplicates using configurable dedupFields before creating. ` +
		`Pass the same fields as the create operation, plus dedupFields (array of API field names for duplicate detection) ` +
		`and errorOnDuplicate (boolean, default false). Use describeFields first to discover available field names. ` +
		`Use updateFields to specify fields to compare against the duplicate — when values differ the duplicate will be updated (outcome: updated). Requires errorOnDuplicate to be false. ` +
		`Returns outcome: created, skipped, updated, or a resource-specific not_found variant.`;
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

const TRUNCATION_SUFFIX = '...[description truncated — call with operation=\'describeFields\' for full field detail]';

/**
 * Truncate a description to fit within the character budget.
 * Cuts at the last word boundary before the limit and appends a visible truncation suffix
 * so the LLM knows content was removed.
 */
function truncateDescription(text: string, limit = 2000): string {
    if (text.length <= limit) return text;
    const cutAt = limit - TRUNCATION_SUFFIX.length;
    const lastSpace = text.lastIndexOf(' ', cutAt);
    const breakpoint = lastSpace > 0 ? lastSpace : cutAt;
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
    const hasWriteOps = operations.some(op =>
        op === 'create' || op === 'update' || op === 'delete'
        || op === 'createIfNotExists' || op === 'approve' || op === 'reject'
        || op === 'moveToCompany' || op === 'moveConfigurationItem' || op === 'transferOwnership',
    );
    const allOps = [...new Set([...operations, 'describeFields', 'listPicklistValues'])];
    const sections: string[] = [];

    // Safety-critical header — always first, guaranteed to survive truncation
    if (hasWriteOps) {
        sections.push(
            'WRITE SAFETY: All write operations require field references to resolve exactly.' +
            ' Ambiguous, unmatched, or infrastructure-failed resolutions block execution before any mutation occurs.',
        );
    }

    sections.push(
        `Perform operations on Autotask ${resourceLabel} records.`,
        `Required: 'operation' field — one of: ${allOps.join(', ')}.`,
        dateTimeReferenceSnippet(referenceUtc),
    );

    for (const op of operations) {
        let summary: string;
        switch (op) {
            case 'get':
                summary = `operation '${op}': Retrieve a single record by numeric 'id'.`;
                break;
            case 'whoAmI':
                summary = `operation '${op}': Resolve the authenticated ${resourceLabel} record.`;
                break;
            case 'getMany':
                summary = `operation '${op}': Search records with up to two filters (AND/OR via filter_logic). Use filter_field/filter_value. Supports name-based resolution for reference/picklist filter values.`;
                break;
            case 'count':
                summary = `operation '${op}': Count records matching optional filters.`;
                break;
            case 'searchByDomain':
                summary = `operation '${op}': Search companies by domain string.`;
                break;
            case 'slaHealthCheck':
                summary = `operation '${op}': Run SLA health check for a ticket using 'id' or 'ticketNumber'.`;
                break;
            case 'summary':
                summary = `operation '${op}': Get a compact ticket summary ('id' or 'ticketNumber' required). Computed values, child counts, relationships.`;
                break;
            case 'getPosted':
                summary = `operation '${op}': Get posted time entries with optional filters.`;
                break;
            case 'getUnposted':
                summary = `operation '${op}': Get unposted time entries with optional filters.`;
                break;
            case 'create': {
                summary = `operation '${op}': Create a new record. ${buildRequiredFieldsSummary(writeFields)} Populate every optional field for which you already have data — do not omit known information. Supports name-based resolution for picklist/reference fields.`;
                break;
            }
            case 'update':
                if (resource === 'resourceTimeOffAdditional') {
                    summary = `operation '${op}': Update time-off additional quotas for a resource. Provide 'resourceID' (name or numeric ID, auto-resolved) and the fields to change (annual/additional hours per category). Supports name-based resolution.`;
                } else {
                    summary = `operation '${op}': Update a record by numeric 'id'. Provide only fields to change. Supports name-based resolution for picklist/reference fields.`;
                }
                break;
            case 'delete':
                summary = `operation '${op}': Delete a record by numeric 'id'.`;
                break;
            case 'moveToCompany':
                summary = `operation '${op}': Move a contact to another company.`;
                break;
            case 'moveConfigurationItem':
                summary = `operation '${op}': Clone a configuration item to a different company.`;
                break;
            case 'transferOwnership':
                summary = `operation '${op}': Transfer ownership from source resource to destination resource.`;
                break;
            case 'createIfNotExists':
                summary = buildCreateIfNotExistsDescription(resource);
                break;
            case 'getByResource':
                summary = `operation '${op}': Get record(s) for a specific resource. Provide 'resourceID' as a name or numeric ID (auto-resolved). Use for operations that are scoped to a parent resource rather than queried by their own ID.`;
                break;
            case 'getByYear':
                summary = `operation '${op}': Get the time-off balance for a specific calendar year. Provide 'resourceID' (name or numeric ID, auto-resolved) and 'year' as an integer (e.g. 2024).`;
                break;
            case 'approve':
                summary = `operation '${op}': Approve a pending time off request by numeric 'id'. Changes the request status to approved.`;
                break;
            case 'reject':
                summary = `operation '${op}': Reject a pending time off request by numeric 'id'. Provide an optional 'rejectReason' string to record the reason for rejection.`;
                break;
            default:
                summary = `operation '${op}': Perform ${op} on ${resourceLabel}.`;
        }
        sections.push(summary);
    }

    sections.push(`operation 'describeFields': List all field IDs, types, and metadata. Use mode 'read' or 'write'.`);
    sections.push(`operation 'listPicklistValues': Get valid values for a picklist field. Use 'fieldId' parameter.`);

    if (supportsImpersonation) {
        sections.push(`Impersonation supported: pass 'impersonationResourceId' for write attribution.`);
    }

    return truncateDescription(sections.join(' '));
}
