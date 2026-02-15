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

export function buildGetDescription(resourceLabel: string, resourceName: string): string {
    return (
        `Retrieve a single ${resourceLabel} record by numeric ID. ` +
        `Optionally use 'fields' to return only selected columns. ` +
        `If a record should exist but response is empty, verify API user permissions (including line-of-business access). ` +
        `Do not guess field names. Call autotask_${resourceName}_describeFields (mode 'read') first when unsure.`
    );
}

export function buildGetManyDescription(
    resourceLabel: string,
    resourceName: string,
    readFields: FieldMeta[],
): string {
    const fieldList = listFilterableFields(readFields);

    return (
        `Search ${resourceLabel} records with up to two AND filters. ` +
        `Example: filter_field='companyName', filter_op='contains', filter_value='Acme'. ` +
        `Use filter_value as true/false for boolean fields, and use arrays (or comma-separated values) for in/notIn operators. ` +
        `UDF filtering supports one UDF field per query. ` +
        `Filterable fields include: ${fieldList}. ` +
        `IMPORTANT: The Autotask API always returns records in ascending ID order (oldest first). Without recency or since, limit=1 returns the OLDEST record, not the newest. ` +
        `To get the most recent or latest records, you MUST use recency (for example 'last_7d') or provide since/until in ISO-8601 UTC format (for example 2026-01-01T00:00:00Z). ` +
        `When recency or since is used, the tool automatically filters by date, fetches a wide window, and returns the newest records first, trimmed to limit. ` +
        `If results are unexpectedly empty, check API user security permissions before retrying. ` +
        `Always provide at least one filter when possible. ` +
        `If you are unsure about field names, call autotask_${resourceName}_describeFields first.`
    );
}

export function buildCountDescription(resourceLabel: string): string {
    return (
        `Count ${resourceLabel} records matching optional filters. ` +
        `Use the same filter parameters as getMany and return only the count. ` +
        `For efficient polling-style checks, prefer LastModifiedDate or LastActivityDate filters where available.`
    );
}

export function buildCreateDescription(
    resourceLabel: string,
    resourceName: string,
    writeFields: FieldMeta[],
): string {
    const required = writeFields
        .filter((field) => field.required)
        .map((field) => field.id);
    const requiredList = required.length > 0 ? required.join(', ') : 'none';
    const picklists = writeFields
        .filter((field) => field.isPickList)
        .slice(0, 6)
        .map((field) => field.id);
    const picklistNote = picklists.length > 0
        ? ` Picklist fields (use valid IDs): ${picklists.join(', ')}.`
        : '';
    const parentField = getParentRequirement(resourceName);
    const parentHint = parentField
        ? ` Parent relation required: include ${parentField}.`
        : '';

    return (
        `Create a new ${resourceLabel} record. ` +
        `Required fields: ${requiredList}.${picklistNote}${parentHint} ` +
        `Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
        `Successful creates typically return an itemId to use in follow-up operations. ` +
        `Call autotask_${resourceName}_describeFields (mode 'write') before create if field requirements are unclear. ` +
        `If picklist values fail validation, call autotask_${resourceName}_listPicklistValues.`
    );
}

export function buildUpdateDescription(resourceLabel: string, resourceName: string): string {
    return (
        `Update an existing ${resourceLabel} record by numeric ID. ` +
        `Only provide fields to change (PATCH-style behaviour). ` +
        `Do not assume PUT-style replacement where omitted fields become null. ` +
        `Date-time values must be ISO-8601 and UTC-safe (for example 2026-02-14T03:15:00Z). ` +
        `Call autotask_${resourceName}_describeFields (mode 'write') to verify valid field names and required value types. ` +
        `Use autotask_${resourceName}_listPicklistValues for picklist fields.`
    );
}

export function buildDeleteDescription(resourceLabel: string): string {
    return (
        `Delete a ${resourceLabel} record by numeric ID. ` +
        `Operational delete responses may be minimal, so treat non-200 outcomes as failures. ` +
        `Use getMany or get first to confirm the correct ID before deletion.`
    );
}

export function buildWhoAmIDescription(resourceLabel: string): string {
    return (
        `Resolve the current authenticated ${resourceLabel} record from API credentials. ` +
        `Use this to discover the active Autotask user context before running user-scoped actions. ` +
        `Optionally use 'fields' to limit returned columns.`
    );
}

export function buildPostedTimeEntriesDescription(resourceName: string): string {
    return (
        `Get posted time entries (entries with matching Billing Items). ` +
        `Supports the same optional filters as getMany (up to two AND filters), plus 'limit' and 'fields'. ` +
        `IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
        `To get the most recent posted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
        `For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
        `If field names are uncertain, call autotask_${resourceName}_describeFields first.`
    );
}

export function buildUnpostedTimeEntriesDescription(resourceName: string): string {
    return (
        `Get unposted time entries (entries without matching Billing Items). ` +
        `Supports the same optional filters as getMany (up to two AND filters), plus 'limit' and 'fields'. ` +
        `IMPORTANT: The Autotask API returns records oldest first (ascending ID). Without recency or since, limit=1 returns the OLDEST entry, not the newest. ` +
        `To get the most recent unposted entries, you MUST use recency (for example 'last_24h' or 'last_7d'), or provide since/until in ISO-8601 UTC format. ` +
        `For date-range and advanced posting filters, use the standard Time Entry node operation if needed. ` +
        `If field names are uncertain, call autotask_${resourceName}_describeFields first.`
    );
}

export function buildCompanySearchByDomainDescription(resourceName: string): string {
    return (
        'Search companies by domain using website-style fields. ' +
        "Input can be a bare domain or full URL; the tool normalises it to a domain fragment (for example autotask.net). " +
        "IMPORTANT: Autotask typically stores company websites as full URLs (for example https://www.autotask.net/), so exact operator matches can fail on bare domain input. " +
        "To avoid false negatives, eq/like semantics are handled safely for website matching. " +
        "When searchContactEmails is true (default), if no company website matches exist, the tool searches Contact.emailAddress by domain and resolves the most common canonical company name from companyID references. " +
        `If field names are uncertain, call autotask_${resourceName}_describeFields first.`
    );
}

export function buildTicketSlaHealthCheckDescription(resourceName: string): string {
    return (
        'Run an SLA health check for a ticket using either numeric id or ticketNumber. ' +
        'Returns first-response, resolution-plan, and resolution milestone timing and status in consistent hours (2 decimal places). ' +
        "Use 'ticketFields' to limit which ticket fields are returned in the ticket section. " +
        'Includes wallClockRemainingHours, where negative values indicate overdue milestones. ' +
        'This operation combines data from Ticket and ServiceLevelAgreementResults entities. ' +
        `If field names are uncertain, call autotask_${resourceName}_describeFields first.`
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
        `If field names or expected behaviour are uncertain, call autotask_${resourceName}_describeFields first.`
    );
}

export function buildContactMoveToCompanyDescription(resourceName: string): string {
    return (
        'Move a contact to another company by cloning the contact record and optional related data. ' +
        'Supports duplicate email safeguards, optional company note and attachment copy, contact group copy, and configurable source/destination audit notes. ' +
        'Supports dry run planning which returns source contact details, the destination payload, location resolution, duplicate check result, and planned counts without writing. ' +
        'Supports optional impersonation for write attribution with optional fallback when impersonation is denied. ' +
        `If field names or expected behaviour are uncertain, call autotask_${resourceName}_describeFields first.`
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
        `If field names or expected behaviour are uncertain, call autotask_${resourceName}_describeFields first.`
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
        `Use this when create or update fails due to invalid picklist values.`
    );
}
