import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { describeResource, listPicklistValues } from './aiHelper';
import { EntityValueHelper } from './entity-values/value-helper';

export interface LabelResolution {
    field: string;
    from: string | number;
    to: string | number;
    method: 'picklist' | 'reference';
}

export interface PendingLabelConfirmation {
    field: string;
    label: string;
    candidates: Array<{ id: string | number; displayName: string }>;
    fieldType: 'picklist' | 'reference';
}

export interface LabelResolutionResult {
    values: IDataObject;
    resolutions: LabelResolution[];
    warnings: string[];
    pendingConfirmations: PendingLabelConfirmation[];
}

// Shared utility: detects whether a value looks like a valid Autotask numeric ID.
// Autotask IDs are positive integers (>0). Uses parseInt round-trip to reject
// zero-padded strings like "00123".
function isLikelyId(v: unknown): boolean {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0;
    if (typeof v === 'string' && /^\d+$/.test(v)) {
        const n = parseInt(v, 10);
        return n > 0 && String(n) === v;
    }
    return false;
}

/**
 * Resolve labels to IDs for picklist and reference fields in bodyJson prior to write operations.
 * - Uses describeResource() metadata to detect picklist/reference fields and referenced entity
 * - For picklists: uses inline allowedValues when available, otherwise calls listPicklistValues()
 * - For references: loads entities and matches against formatted display name
 * - Partial/substring matches are NOT auto-resolved — they are returned as pendingConfirmations
 */
export async function resolveLabelsToIds(
    context: IExecuteFunctions,
    resource: string,
    rawValues: IDataObject,
): Promise<LabelResolutionResult> {
    const values: IDataObject = { ...rawValues };
    const resolutions: LabelResolution[] = [];
    const warnings: string[] = [];
    const pendingConfirmations: PendingLabelConfirmation[] = [];
    const pendingFieldIds = new Set<string>();
    const picklistCache = new Map<string, Awaited<ReturnType<typeof listPicklistValues>>>();

    if (!rawValues || Object.keys(rawValues).length === 0) {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    const description = await describeResource(context, resource, 'write');
    const fieldIndex = new Map(description.fields.map(f => [f.id.toLowerCase(), f]));

    for (const [key, provided] of Object.entries(rawValues)) {
        const field = fieldIndex.get(key.toLowerCase());
        if (!field) {
            console.debug(`[labelResolution] Field '${key}' not found in write metadata for '${resource}', skipping`);
            continue;
        }
        if (provided === null || provided === undefined) continue;

        // Skip if already looks like an ID
        if (isLikelyId(provided)) continue;

        // Picklist resolution by label
        if (field.isPickList) {
            const label = String(provided).trim();
            if (label === '') continue;
            let idMatch: string | number | undefined;

            // Try inline allowed values first
            if (field.allowedValues && field.allowedValues.length > 0) {
                const match = field.allowedValues.find(v => String(v.label).toLowerCase() === label.toLowerCase());
                if (match) idMatch = match.id;
            }

            // If not found, query values via helper (paginated) — with cache
            if (idMatch === undefined) {
                try {
                    const cacheKey = `${resource}.${field.id}`;
                    let result = picklistCache.get(cacheKey);
                    if (!result) {
                        // Fetch ALL active values (no query filter) so the cache is reusable across labels
                        result = await listPicklistValues(context, resource, field.id, undefined, 500, 1);
                        picklistCache.set(cacheKey, result);
                    }
                    // 1. Exact case-insensitive match only
                    const exact = result.values.find(v => v.label.toLowerCase() === label.toLowerCase());
                    if (exact) {
                        idMatch = exact.id;
                    } else {
                        // Partial matches → pendingConfirmations (never auto-resolve)
                        const subMatches = result.values.filter(v =>
                            v.label.toLowerCase().includes(label.toLowerCase()),
                        );
                        if (subMatches.length > 0) {
                            pendingConfirmations.push({
                                field: field.id,
                                label,
                                candidates: subMatches.map(v => ({ id: v.id, displayName: v.label })),
                                fieldType: 'picklist',
                            });
                            pendingFieldIds.add(field.id);
                        }
                        // idMatch stays undefined — field keeps raw value
                    }
                } catch (err) {
                    const msg = (err as Error).message ?? String(err);
                    const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
                    warnings.push(
                        isInfra
                            ? `[INFRASTRUCTURE] Picklist resolution failed for '${field.id}': ${msg}. Value sent as-is.`
                            : `Picklist resolution error for '${field.id}': ${msg}`,
                    );
                }
            }

            if (idMatch !== undefined) {
                values[key] = idMatch;
                resolutions.push({ field: field.id, from: label, to: idMatch, method: 'picklist' });
            } else if (!pendingFieldIds.has(field.id)) {
                warnings.push(`Could not resolve picklist label '${label}' for field '${field.id}'`);
            }

            continue;
        }

        // Reference resolution by display name
        if (field.isReference && field.referencesEntity) {
            const label = String(provided).trim();
            if (label === '') continue;
            try {
                const helper = new EntityValueHelper(context, field.referencesEntity);

                // Two-pass active→all approach
                // Pass 1: Active entities only
                const activeCandidates = await helper.getValues(true);
                let allCandidates: Awaited<ReturnType<typeof helper.getValues>> | undefined;
                let bestId: string | number | undefined;

                for (const entity of activeCandidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    if (display && display.toLowerCase() === label.toLowerCase()) {
                        bestId = (entity as unknown as IDataObject).id as string | number;
                        break;
                    }
                }

                // No exact match in active set — try Pass 2 (all entities including inactive)
                if (bestId === undefined) {
                    allCandidates = await helper.getValues(false);

                    for (const entity of allCandidates) {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        if (display && display.toLowerCase() === label.toLowerCase()) {
                            bestId = (entity as unknown as IDataObject).id as string | number;
                            break;
                        }
                    }
                }

                // Still no exact match — collect partial matches from both active and all sets
                if (bestId === undefined) {
                    const seenIds = new Set<string | number>();
                    const allPartials: Array<{ id: string | number; displayName: string }> = [];

                    for (const entity of activeCandidates) {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        const id = (entity as unknown as IDataObject).id as string | number;
                        if (display && display.toLowerCase().includes(label.toLowerCase())) {
                            seenIds.add(id);
                            allPartials.push({ id, displayName: display });
                        }
                    }

                    // Reuse allCandidates from Pass 2 (already fetched above)
                    const allForPartials = allCandidates ?? await helper.getValues(false);
                    for (const entity of allForPartials) {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        const id = (entity as unknown as IDataObject).id as string | number;
                        if (display && display.toLowerCase().includes(label.toLowerCase()) && !seenIds.has(id)) {
                            allPartials.push({ id, displayName: display });
                        }
                    }

                    if (allPartials.length > 0) {
                        pendingConfirmations.push({
                            field: field.id,
                            label,
                            candidates: allPartials,
                            fieldType: 'reference',
                        });
                        pendingFieldIds.add(field.id);
                    }
                }

                if (bestId !== undefined) {
                    values[key] = bestId;
                    resolutions.push({ field: field.id, from: label, to: bestId, method: 'reference' });
                } else if (!pendingFieldIds.has(field.id)) {
                    warnings.push(`Could not resolve reference label '${label}' for field '${field.id}' (${field.referencesEntity})`);
                }
            } catch (err) {
                // Infrastructure-aware error classification
                const msg = (err as Error).message ?? String(err);
                const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
                warnings.push(
                    isInfra
                        ? `[INFRASTRUCTURE] Resolution failed for '${field.id}' (${field.referencesEntity}): ${msg}. Value sent as-is.`
                        : `Resolution error for '${field.id}': ${msg}`,
                );
            }
        // Unknown entity type for reference field
        } else if (field.isReference && !field.referencesEntity) {
            warnings.push(
                `Reference field '${field.id}' has no known entity type — provide a numeric ID directly, ` +
                `or use autotask_${resource} with operation 'describeFields' to inspect.`,
            );
        }
    }

    return { values, resolutions, warnings, pendingConfirmations };
}

/**
 * Resolve labels to IDs for filter values on reference/picklist fields in read operations.
 * Reuses the same resolution infrastructure as write operations but operates on filter triplets.
 *
 * When filter_field is a reference or picklist field and filter_value is a non-numeric string,
 * auto-resolve it before building the API filter.
 */
export async function resolveFilterLabelsToIds(
    context: IExecuteFunctions,
    resource: string,
    filterField: string,
    filterValue: string | number | boolean | Array<string | number | boolean>,
    readFields: Array<{ id: string; isPickList?: boolean; isReference?: boolean; referencesEntity?: string; allowedValues?: Array<{ id: string | number; label: string }> }>,
): Promise<LabelResolutionResult> {
    const values: IDataObject = { [filterField]: filterValue };
    const resolutions: LabelResolution[] = [];
    const warnings: string[] = [];
    const pendingConfirmations: PendingLabelConfirmation[] = [];

    // Only attempt resolution on string values (not numbers, booleans, or arrays)
    if (typeof filterValue !== 'string' || filterValue.trim() === '') {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    if (isLikelyId(filterValue)) {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    // Find the field metadata in read fields
    const field = readFields.find(f => f.id.toLowerCase() === filterField.toLowerCase());
    if (!field) {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    const label = filterValue.trim();

    // Picklist resolution
    if (field.isPickList) {
        let idMatch: string | number | undefined;

        // Try inline allowed values first
        if (field.allowedValues && field.allowedValues.length > 0) {
            const match = field.allowedValues.find(v => String(v.label).toLowerCase() === label.toLowerCase());
            if (match) idMatch = match.id;
        }

        // If not found, query via helper
        if (idMatch === undefined) {
            try {
                const result = await listPicklistValues(context, resource, field.id, undefined, 500, 1);
                const exact = result.values.find(v => v.label.toLowerCase() === label.toLowerCase());
                if (exact) {
                    idMatch = exact.id;
                } else {
                    const subMatches = result.values.filter(v =>
                        v.label.toLowerCase().includes(label.toLowerCase()),
                    );
                    if (subMatches.length > 0) {
                        pendingConfirmations.push({
                            field: filterField,
                            label,
                            candidates: subMatches.map(v => ({ id: v.id, displayName: v.label })),
                            fieldType: 'picklist',
                        });
                    }
                }
            } catch (err) {
                const msg = (err as Error).message ?? String(err);
                const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
                warnings.push(
                    isInfra
                        ? `[INFRASTRUCTURE] Filter picklist resolution failed for '${filterField}': ${msg}. Value sent as-is.`
                        : `Filter picklist resolution error for '${filterField}': ${msg}`,
                );
            }
        }

        if (idMatch !== undefined) {
            values[filterField] = idMatch;
            resolutions.push({ field: filterField, from: label, to: idMatch, method: 'picklist' });
        } else if (pendingConfirmations.length === 0) {
            warnings.push(`Could not resolve picklist filter label '${label}' for field '${filterField}'`);
        }
        return { values, resolutions, warnings, pendingConfirmations };
    }

    // Reference resolution
    if (field.isReference && field.referencesEntity) {
        try {
            const helper = new EntityValueHelper(context, field.referencesEntity);

            // Pass 1: Active entities
            const activeCandidates = await helper.getValues(true);
            let allCandidates: Awaited<ReturnType<typeof helper.getValues>> | undefined;
            let bestId: string | number | undefined;

            for (const entity of activeCandidates) {
                const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                if (display && display.toLowerCase() === label.toLowerCase()) {
                    bestId = (entity as unknown as IDataObject).id as string | number;
                    break;
                }
            }

            // No exact match in active set — try Pass 2 (all entities including inactive)
            if (bestId === undefined) {
                allCandidates = await helper.getValues(false);

                for (const entity of allCandidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    if (display && display.toLowerCase() === label.toLowerCase()) {
                        bestId = (entity as unknown as IDataObject).id as string | number;
                        break;
                    }
                }
            }

            // Still no exact match — collect partial matches from both active and all sets
            if (bestId === undefined) {
                const seenIds = new Set<string | number>();
                const allPartials: Array<{ id: string | number; displayName: string }> = [];

                for (const entity of activeCandidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    const id = (entity as unknown as IDataObject).id as string | number;
                    if (display && display.toLowerCase().includes(label.toLowerCase())) {
                        seenIds.add(id);
                        allPartials.push({ id, displayName: display });
                    }
                }

                // Reuse allCandidates from Pass 2 (already fetched above)
                const allForPartials = allCandidates ?? await helper.getValues(false);
                for (const entity of allForPartials) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    const id = (entity as unknown as IDataObject).id as string | number;
                    if (display && display.toLowerCase().includes(label.toLowerCase()) && !seenIds.has(id)) {
                        allPartials.push({ id, displayName: display });
                    }
                }

                if (allPartials.length > 0) {
                    pendingConfirmations.push({
                        field: filterField,
                        label,
                        candidates: allPartials,
                        fieldType: 'reference',
                    });
                }
            }

            if (bestId !== undefined) {
                values[filterField] = bestId;
                resolutions.push({ field: filterField, from: label, to: bestId, method: 'reference' });
            } else if (pendingConfirmations.length === 0) {
                warnings.push(`Could not resolve reference filter label '${label}' for field '${filterField}' (${field.referencesEntity})`);
            }
        } catch (err) {
            const msg = (err as Error).message ?? String(err);
            const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
            warnings.push(
                isInfra
                    ? `[INFRASTRUCTURE] Filter resolution failed for '${filterField}' (${field.referencesEntity}): ${msg}. Value sent as-is.`
                    : `Filter resolution error for '${filterField}': ${msg}`,
            );
        }
    } else if (field.isReference && !field.referencesEntity) {
        warnings.push(
            `Reference filter field '${filterField}' has no known entity type — provide a numeric ID directly, ` +
            `or use autotask_${resource} with operation 'describeFields' to inspect.`,
        );
    }

    return { values, resolutions, warnings, pendingConfirmations };
}
