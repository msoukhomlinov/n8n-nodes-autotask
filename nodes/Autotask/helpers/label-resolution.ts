import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { describeResource, listPicklistValues } from './aiHelper';
import { EntityValueHelper } from './entity-values/value-helper';

export interface LabelResolution {
    field: string;
    from: string | number;
    to: string | number;
    method: 'picklist' | 'reference';
}

export interface LabelResolutionResult {
    values: IDataObject;
    resolutions: LabelResolution[];
    warnings: string[];
}

/**
 * Resolve labels to IDs for picklist and reference fields in bodyJson prior to write operations.
 * - Uses describeResource() metadata to detect picklist/reference fields and referenced entity
 * - For picklists: uses inline allowedValues when available, otherwise calls listPicklistValues()
 * - For references: loads entities and matches against formatted display name
 */
export async function resolveLabelsToIds(
    context: IExecuteFunctions,
    resource: string,
    rawValues: IDataObject,
): Promise<LabelResolutionResult> {
    const values: IDataObject = { ...rawValues };
    const resolutions: LabelResolution[] = [];
    const warnings: string[] = [];

    if (!rawValues || Object.keys(rawValues).length === 0) {
        return { values, resolutions, warnings };
    }

    const description = await describeResource(context, resource, 'write');
    const fieldIndex = new Map(description.fields.map(f => [f.id.toLowerCase(), f]));

    const isLikelyId = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v));

    for (const [key, provided] of Object.entries(rawValues)) {
        const field = fieldIndex.get(key.toLowerCase());
        if (!field || provided === null || provided === undefined) continue;

        // Skip if already looks like an ID
        if (isLikelyId(provided)) continue;

        // Picklist resolution by label
        if (field.isPickList) {
            const label = String(provided).trim();
            let idMatch: string | number | undefined;

            // Try inline allowed values first
            if (field.allowedValues && field.allowedValues.length > 0) {
                const match = field.allowedValues.find(v => String(v.label).toLowerCase() === label.toLowerCase());
                if (match) idMatch = match.id;
            }

            // If not found, query values via helper (paginated)
            if (idMatch === undefined) {
                const result = await listPicklistValues(context, resource, field.id, label, 50, 1);
                // 1. Exact case-insensitive match
                const exact = result.values.find(v => v.label.toLowerCase() === label.toLowerCase());
                // 2. Substring match — only accepted when unambiguous (exactly one candidate)
                const subMatches = result.values.filter(v => v.label.toLowerCase().includes(label.toLowerCase()));
                const partial = subMatches.length === 1 ? subMatches[0] : undefined;
                if (subMatches.length > 1) {
                    warnings.push(`Ambiguous picklist label '${label}' for field '${field.id}': ${subMatches.length} candidates matched (${subMatches.map(v => v.label).join(', ')}). Provide an exact label.`);
                }
                idMatch = exact?.id ?? partial?.id;
            }

            if (idMatch !== undefined) {
                values[key] = idMatch;
                resolutions.push({ field: field.id, from: label, to: idMatch, method: 'picklist' });
            } else {
                warnings.push(`Could not resolve picklist label '${label}' for field '${field.id}'`);
            }

            continue;
        }

        // Reference resolution by display name
        if (field.isReference && field.referencesEntity) {
            const label = String(provided).trim();
            try {
                const helper = new EntityValueHelper(context, field.referencesEntity);
                const candidates = await helper.getValues(true);
                let bestId: string | number | undefined;

                for (const entity of candidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    if (display && display.toLowerCase() === label.toLowerCase()) {
                        bestId = (entity as unknown as IDataObject).id as string | number;
                        break;
                    }
                }

                if (bestId === undefined) {
                    // Fallback: substring match — only accepted when unambiguous (exactly one candidate)
                    const subMatches = candidates.filter(entity => {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        return display && display.toLowerCase().includes(label.toLowerCase());
                    });
                    if (subMatches.length === 1) {
                        bestId = (subMatches[0] as unknown as IDataObject).id as string | number;
                    } else if (subMatches.length > 1) {
                        warnings.push(`Ambiguous reference label '${label}' for field '${field.id}' (${field.referencesEntity}): ${subMatches.length} candidates matched. Provide an exact label.`);
                    }
                }

                if (bestId !== undefined) {
                    values[key] = bestId;
                    resolutions.push({ field: field.id, from: label, to: bestId, method: 'reference' });
                } else {
                    warnings.push(`Could not resolve reference label '${label}' for field '${field.id}' (${field.referencesEntity})`);
                }
            } catch (err) {
                warnings.push(`Resolution error for '${field.id}': ${(err as Error).message}`);
            }
        }
    }

    return { values, resolutions, warnings };
}


