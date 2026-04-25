/**
 * Per-resource filter-field alias map.
 *
 * Maps common LLM field-name mistakes to canonical API field names. Applied in
 * buildFilterFromParams BEFORE the readFields lookup so the alias resolves to a
 * real field and label resolution / type coercion work normally.
 *
 * Safety rule: an alias is ONLY applied when the raw (mistake) field name is NOT
 * itself a real field on the entity. This prevents shadowing if Autotask ever adds
 * a field whose name matches an alias key.
 *
 * Keys must be lowercase (comparison is done with .toLowerCase()).
 * Values must be the exact canonical API field name (case-sensitive).
 */
export const FILTER_FIELD_ALIASES: Record<string, Record<string, string>> = {
    company: {
        name: 'companyName',
        companyname: 'companyName',
        company_name: 'companyName',
        accountname: 'companyName',
    },
    ticket: {
        title: 'subject',
        name: 'subject',
        summary: 'subject',
        description: 'subject',
        createdatetime: 'createDate',
        createddatetime: 'createDate',
        createddate: 'createDate',
        assignedresource: 'assignedResourceID',
        resourceid: 'assignedResourceID',
        owner: 'assignedResourceID',
        ownerresourceid: 'assignedResourceID',
        ticketno: 'ticketNumber',
        number: 'ticketNumber',
    },
    resource: {
        name: 'lastName',
        fullname: 'lastName',
    },
    project: {
        name: 'projectName',
        title: 'projectName',
    },
    contract: {
        name: 'contractName',
    },
    task: {
        name: 'title',
        subject: 'title',
    },
};

/**
 * Resolve a raw filter_field name to its canonical alias if one exists for this resource.
 * Returns the original field unchanged when no alias applies.
 *
 * @param resource  - resource key (e.g. 'company', 'ticket')
 * @param rawField  - the field name as supplied by the model
 * @param readFieldIds - optional set of lowercased real field IDs; when supplied, aliases are
 *   suppressed for fields that already exist on the entity (safety guard)
 */
export function resolveFilterFieldAlias(
    resource: string,
    rawField: string | undefined,
    readFieldIds?: Set<string>,
): { resolved: string; aliasedFrom?: string } {
    if (!rawField || typeof rawField !== 'string') return { resolved: rawField ?? '' };
    const aliasMap = FILTER_FIELD_ALIASES[resource];
    if (!aliasMap) return { resolved: rawField };
    const lower = rawField.trim().toLowerCase();
    const canonical = aliasMap[lower];
    if (!canonical) return { resolved: rawField };
    // Safety guard: don't alias a field that actually exists on this entity
    if (readFieldIds && readFieldIds.has(lower)) return { resolved: rawField };
    return { resolved: canonical, aliasedFrom: rawField };
}
