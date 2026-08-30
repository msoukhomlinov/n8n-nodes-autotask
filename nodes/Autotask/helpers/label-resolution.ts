import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { describeResource, getReferencedEntity, listPicklistValues } from './aiHelper';
import { EntityValueHelper } from './entity-values/value-helper';
import type { IAutotaskEntity } from '../types';
import { PICKLIST_REFERENCE_FIELD_MAPPINGS } from '../constants/field.constants';
import type { IPicklistReferenceFieldMapping } from '../types/base/picklists';
import { isLikelyId } from './id-utils';
export { isLikelyId } from './id-utils';
import {
    tryResolveTypedReference,
    TYPED_REFERENCE_COMPANION_FIELDS,
} from './typed-reference';

/** Actionable hints appended to no-match warnings when a reference entity has a known lookup operation. */
const REFERENCE_RESOLUTION_HINTS: Record<string, string> = {
    Role: `Call autotask_timeEntry with operation 'getAvailableRoles' (resourceID + ticketID) to list valid roles for this resource.`,
    Queue: `Call autotask_ticket with operation 'listPicklistValues' and fieldId='queueID' to list valid queues.`,
};

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

function inferReferenceEntityFromField(fieldId: string, resource: string): string | undefined {
    return getReferencedEntity(fieldId, resource);
}

function getEntityFieldMapping(entityType: string): IPicklistReferenceFieldMapping | undefined {
    const direct = PICKLIST_REFERENCE_FIELD_MAPPINGS[entityType];
    if (direct) return direct;

    const lowerType = entityType.toLowerCase();
    const key = Object.keys(PICKLIST_REFERENCE_FIELD_MAPPINGS).find(
        k => k.toLowerCase() === lowerType,
    );
    return key ? PICKLIST_REFERENCE_FIELD_MAPPINGS[key] : undefined;
}

function getEntityNameFields(entityType: string): string[] {
    return getEntityFieldMapping(entityType)?.nameFields ?? [];
}

/**
 * v2.29.x (R9): true when the entity has exactly ONE name field plus a bracket
 * field (e.g. ConfigurationItem: referenceTitle + referenceNumber → display
 * "Server (CI-123)"). For these entities a bare name label can NEVER equal the
 * formatted display name, so the unique name-field exact match is the only
 * exact resolution path for it.
 *
 * Single-name-field entities WITHOUT brackets (Company: display = companyName)
 * already resolve through the display-name pass — no extra path needed.
 * Multi-name-field entities (Resource/Contact: firstName + lastName) are covered
 * by the `nameFields.length >= 2` gate at the call sites.
 */
function hasSingleBracketedNameField(entityType: string): boolean {
    const mapping = getEntityFieldMapping(entityType);
    if (!mapping || mapping.nameFields.length !== 1) return false;
    const bracket = mapping.bracketField;
    return Boolean(bracket && (Array.isArray(bracket) ? bracket.length > 0 : true));
}

/**
 * v2.29.x (C1): bounded candidate-probe outcome. `rows` is the deduped
 * candidate pool; `probeError`/`truncated` flag probes that were rejected
 * by the API or that saturated at the row cap, in which case the pool is an
 * arbitrary sample — not the entity population — and any uniqueness derived
 * from it (e.g. findUniqueNameFieldMatchId) cannot be trusted.
 */
interface ReferenceCandidatePool {
    rows: Array<Record<string, unknown>>;
    /** True if one or more probes for this pool were rejected by the API. */
    probeError: boolean;
    /** True if one or more probes returned the full row cap — the returned window is arbitrary. */
    truncated: boolean;
}

/** False when the pool's `rows` cannot be trusted for uniqueness/exact-match decisions. */
function poolIsComplete(pool: ReferenceCandidatePool): boolean {
    return !pool.probeError && !pool.truncated;
}

/** Row cap per display probe (passed to getValuesByDisplay as MaxRecords). */
const PROBE_ROW_LIMIT = 50;

/**
 * v2.29.0 (X16), tightened in v2.29.x (B4), broadened in B1: bounded
 * candidate pool for reference-label resolution. A small per display-name-
 * field probe (exact first, `contains` — probe values PLUS the full label —
 * only if the exact pass left no candidate whose display name exactly
 * matches the label) replaces the previous full-entity scan (getValues),
 * which on large reference populations (~24k ConfigurationItems) took
 * minutes and hung the tool call past the MCP protocol timeout.
 *
 * Probe values (B4a, extended in v2.29.x C1): the whitespace tokens of the
 * label with length >= 2, deduped and capped at two, ALWAYS alongside the
 * full label. Before C1 the full label was probed only when no token
 * qualified — a multi-token label was never eq-probed in full, so its
 * uniqueness was judged from a truncated `contains` sample. Single-token
 * labels ('Contoso', 'EPSON-TX610FW') produce exactly one probe value —
 * unchanged probe cost vs v2.29.0. On composite-name entities (Resource/
 * Contact: firstName + lastName) a label like 'Max Soukhomlinov' matches
 * NEITHER name field individually, so the token probes are what pull the
 * entity into the pool, where the downstream exact / unique display-name
 * matching resolves it. Labels spanning multiple fields (e.g. 'Max S')
 * surface as partial-match confirmations or a 'use a numeric ID' warning
 * instead of a hang.
 *
 * Completeness (C1): the result reports `probeError` (one or more probes
 * were rejected by the API) and `truncated` (one or more probes saturated
 * at the row cap). When either is set, the pool is an arbitrary sample
 * rather than the entity population — write-path auto-resolution is gated
 * on both being clear, and the read path surfaces a warning.
 *
 * Name fields (B4d): taken from the value-helper's usable-name-field gate
 * (mapping entry or metadata scan) instead of re-deriving them here; the
 * `['name']` fallback survives only when the gate yields no list. Probes
 * run with bounded concurrency <= 4 (B4b) instead of sequential awaits.
 */
async function fetchReferenceCandidates(
    helper: EntityValueHelper<IAutotaskEntity>,
    entityType: string,
    label: string,
    activeOnly: boolean,
): Promise<ReferenceCandidatePool> {
    // B4d: usable name fields come from the value-helper gate (B5) — the
    // ['name'] fallback applies only when the gate yields no list (null).
    // (entityType is part of the stable call signature; the helper already
    // carries it for the gate.)
    const usableNameFields = await helper.getUsableReferenceNameFields();
    const nameFields = usableNameFields ?? ['name'];
    // B4a (extended in v2.29.x C1): whitespace tokens (length >= 2), deduped,
    // capped at two — plus the full label, always. eq-probing the full label
    // at stage 1 means uniqueness for multi-token labels is established on an
    // exact probe instead of a truncated `contains` sample.
    const tokenProbes = Array.from(new Set(label.split(/\s+/).filter((token) => token.length >= 2))).slice(0, 2);
    const probeValues = Array.from(new Set([...tokenProbes, label]));

    const pool = new Map<string | number, Record<string, unknown>>();
    let firstError: Error | undefined;
    // C1: a probe that returns the full row cap hit an arbitrary window — the
    // pool is then a sample and callers must not assert uniqueness over it.
    let truncated = false;

    const buildProbeTasks = (
        op: 'eq' | 'contains',
        probeSet: string[] = probeValues,
    ): Array<() => Promise<void>> => {
        const tasks: Array<() => Promise<void>> = [];
        for (const nameField of nameFields) {
            for (const probeValue of probeSet) {
                tasks.push(async () => {
                    try {
                        const rows = await helper.getValuesByDisplay(nameField, probeValue, activeOnly, op, PROBE_ROW_LIMIT);
                        if (rows.length >= PROBE_ROW_LIMIT) truncated = true;
                        for (const row of rows) {
                            const data = row as unknown as Record<string, unknown>;
                            const id = data.id as string | number | undefined;
                            if (id !== undefined) pool.set(id, data);
                        }
                    } catch (err) {
                        // Best-effort: a probe rejected because the entity lacks that
                        // field (or the API rejected the value) must not abort
                        // resolution on the remaining probes — but if EVERY probe
                        // fails, the caller must see the error (a silent pass-through
                        // made unresolved labels look like deliberate negatives on the wire).
                        if (!firstError) firstError = err instanceof Error ? err : new Error(String(err));
                    }
                });
            }
        }
        return tasks;
    };

    // B4b: bounded-concurrency runner — at most `limit` probes in flight.
    const runBounded = async (tasks: Array<() => Promise<void>>, limit: number): Promise<void> => {
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < tasks.length) {
                const index = next;
                next += 1;
                await tasks[index]();
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    };

    // B4c (extended in v2.29.x C1): stage 1 = exact ('eq') probes over the
    // token probe values PLUS the full label (since C1 the full label is
    // always in probeValues); stage 2 = 'contains' probes over the same
    // values (a composite record like 'Acme Corporation' is only findable
    // via a multi-word contains probe).
    await runBounded(buildProbeTasks('eq'), 4);

    // B1: an exact token hit on ANOTHER record (label 'Acme Corporation'
    // while a company named 'Acme' exists) fills the pool at stage 1, so
    // gating stage 2 on `pool.size === 0` suppressed the broader pass and
    // the requested record was never probed — downstream exact display-name
    // matching then failed and valid name-based writes/filters were blocked.
    // Stage 2 now runs unless the pool already holds a candidate whose
    // display name EXACTLY matches the label: any single name field equals
    // it, or the whitespace-joined composite of the name fields does
    // (case-insensitive, non-empty parts only — mirrors the display-name
    // join, so composite entities like Resource resolve without the extra
    // contains pass).
    const poolMatchesLabel = (): boolean => {
        const target = label.toLowerCase();
        for (const row of pool.values()) {
            const parts = nameFields
                .map((nameField) => {
                    const raw = row[nameField];
                    return raw === undefined || raw === null ? '' : String(raw).trim();
                })
                .filter((part) => part !== '');
            if (parts.some((part) => part.toLowerCase() === target)) return true;
            if (parts.join(' ').toLowerCase() === target) return true;
        }
        return false;
    };

    if (!poolMatchesLabel()) {
        // The full label is already in probeValues (C1) — the Set keeps the
        // stage self-documenting in case probeValues' construction changes.
        const stage2ProbeValues = Array.from(new Set([...probeValues, label]));
        await runBounded(buildProbeTasks('contains', stage2ProbeValues), 4);
    }
    if (pool.size === 0 && firstError) throw firstError;
    // C1: propagate pool completeness — a partial probe failure or a
    // saturated probe means the pool is a sample, and callers that assert
    // uniqueness over it (write-path auto-resolution) must see that.
    return {
        rows: Array.from(pool.values()),
        probeError: firstError !== undefined,
        truncated,
    };
}

function findUniqueNameFieldMatchId(
    entities: IDataObject[],
    label: string,
    nameFields: string[],
): string | number | undefined {
    const trimmedLabel = label.trim();
    // v2.29.x (R9): the legacy `nameFields.length < 2` guard assumed single-
    // name-field entities were fully covered by the formatted display-name
    // match — true for bracket-less entities (Company: display = companyName)
    // but false for single-name-field entities with a bracket field
    // (ConfigurationItem: "Server (CI-123)"), where a bare title can never
    // equal the display. This path is their only exact match; the uniqueness
    // rule below still prevents a random pick on duplicate titles.
    if (trimmedLabel === '' || nameFields.length === 0) {
        return undefined;
    }

    const target = trimmedLabel.toLowerCase();
    const matchedIds: Array<string | number> = [];
    const seenIds = new Set<string | number>();

    for (const entity of entities) {
        const id = entity.id as string | number | undefined;
        if (id === undefined || seenIds.has(id)) continue;

        for (const field of nameFields) {
            const raw = entity[field];
            const strValue = typeof raw === 'string' ? raw.trim() : '';
            if (strValue !== '' && strValue.toLowerCase() === target) {
                seenIds.add(id);
                matchedIds.push(id);
                break;
            }
        }
    }

    return matchedIds.length === 1 ? matchedIds[0] : undefined;
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
    siblingValues?: IDataObject,
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
        if (isLikelyId(provided)) {
            if (typeof provided === 'string' && (field.isPickList || field.isReference)) values[key] = Number(provided);
            continue;
        }

        // Picklist resolution by label
        if (field.isPickList) {
            const label = String(provided).trim();
            if (label === '') continue;
            let idMatch: string | number | undefined;
            // v2.28.9 r7 (C1): set when the picklist lookup itself failed.
            // The value was then NEVER validated — a [PICKLIST_MISMATCH] for it
            // would assert "invalid" for a value the API never saw.
            let picklistLookupFailed = false;

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
                            ? `[INFRASTRUCTURE] Picklist resolution failed for field '${field.id}': ${msg}. Value sent as-is.`
                            : `Picklist resolution error for field '${field.id}': ${msg}`,
                    );
                    picklistLookupFailed = true;
                }
            }

            if (idMatch !== undefined) {
                values[key] = idMatch;
                resolutions.push({ field: field.id, from: label, to: idMatch, method: 'picklist' });
            } else if (!pendingFieldIds.has(field.id) && !picklistLookupFailed) {
                // [PICKLIST_MISMATCH] tag: write-guard.ts partitions on this to
                // classify invalid picklist values as INVALID_PICKLIST_VALUE with the
                // listPicklistValues retry directive (v2.28.5). The read-filter branch
                // keeps its own untagged wording (INVALID_FILTER_CONSTRAINT path).
                // Suppressed when the lookup itself failed (v2.28.9 r7, C1): the catch
                // above already recorded the failure and the value was never validated —
                // emitting the mismatch tag on top made write-guard classify the outage
                // as INVALID_PICKLIST_VALUE and direct the model to retry
                // listPicklistValues into the same outage.
                warnings.push(`[PICKLIST_MISMATCH] Could not resolve picklist value '${label}' for field '${field.id}'`);
            }

            continue;
        }

        // Reference resolution by display name
        if (field.isReference && field.referencesEntity) {
            const label = String(provided).trim();
            if (label === '') continue;

            // Typed-reference fast path (ticket numbers, project numbers, etc.).
            // Short-circuits the expensive EntityValueHelper full-list scan when the
            // referenced entity has a registered strategy.
            // siblingValues is undefined on standard-node call sites (no companion field
            // available there), so the resolver falls back to strategy.defaultSearchField.
            const typed = await tryResolveTypedReference(
                context,
                field.referencesEntity,
                label,
                siblingValues ?? {},
            );
            if (typed.status === 'resolved') {
                values[key] = typed.id;
                resolutions.push({
                    field: field.id,
                    from: label,
                    to: typed.id,
                    method: 'reference',
                });
                continue;
            }
            if (typed.status === 'pending') {
                pendingConfirmations.push({
                    field: field.id,
                    label,
                    candidates: typed.candidates,
                    fieldType: 'reference',
                });
                pendingFieldIds.add(field.id);
                continue;
            }
            if (typed.status === 'miss') {
                warnings.push(typed.warning);
                continue;
            }
            // 'skip' → fall through to existing EntityValueHelper path (unchanged).
            try {
                const helper = new EntityValueHelper(context, field.referencesEntity);

                // Two-pass active→all approach
                // Pass 1: Active entities only
                const activePool = await fetchReferenceCandidates(helper, field.referencesEntity, label, true);
                const activeCandidates = activePool.rows;
                let allPool: ReferenceCandidatePool | undefined;
                let allCandidates: Array<Record<string, unknown>> | undefined;
                let bestId: string | number | undefined;
                // x3 V1: the write path gates auto-resolution on pool
                // completeness with the same signal the read path carries as
                // probeIncomplete (and the R9 name-field gate below uses). A
                // pool fed by a rejected probe or a row-cap-saturated probe is
                // an arbitrary sample — an exact display match inside it may be
                // one of many identically-displayed records, so auto-resolving
                // it into the write body would be an arbitrary pick. bestId
                // stays undefined and the field routes to
                // pendingConfirmations / the no-match warning instead.
                const activeProbeIncomplete = !poolIsComplete(activePool);
                // A field yields at most ONE [NAME_POOL_INCOMPLETE] warning:
                // the pass-1, pass-2, and R9 gates below share this flag.
                let incompleteWarned = false;
                const noteIncompletePool = (): void => {
                    if (incompleteWarned) return;
                    incompleteWarned = true;
                    warnings.push(
                        `[NAME_POOL_INCOMPLETE] Identity of exact match '${label}' for field '${field.id}' (${field.referencesEntity}) ` +
                        'could not be verified — the candidate sample was incomplete (a probe failed or hit its row cap). ' +
                        'Confirm the record or supply the numeric ID.',
                    );
                };

                for (const entity of activeCandidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    if (display && display.toLowerCase() === label.toLowerCase()) {
                        if (activeProbeIncomplete) {
                            noteIncompletePool();
                            break;
                        }
                        bestId = (entity as unknown as IDataObject).id as string | number;
                        break;
                    }
                }

                // No exact match in active set — try Pass 2 (all entities including inactive)
                if (bestId === undefined) {
                    allPool = await fetchReferenceCandidates(helper, field.referencesEntity, label, false);
                    allCandidates = allPool.rows;
                    const allProbeIncomplete = !poolIsComplete(allPool);

                    for (const entity of allCandidates) {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        if (display && display.toLowerCase() === label.toLowerCase()) {
                            if (allProbeIncomplete) {
                                noteIncompletePool();
                                break;
                            }
                            bestId = (entity as unknown as IDataObject).id as string | number;
                            break;
                        }
                    }
                }

                // v2.29.x (R9, gated by C1): single-name-field entities with
                // a bracketed display (e.g. ConfigurationItem "Server
                // (CI-123)") can never match a bare title through the
                // formatted display above. For these entities the name field
                // IS the full identifier, so a UNIQUE exact name-field match
                // is unambiguous (duplicate titles — 2+ CIs titled "Server" —
                // stay ambiguous and confirmation-gated). Multi-name-field
                // entities are deliberately excluded: a bare first name
                // ("Max") is a partial identifier there and remains
                // confirmation-gated on writes.
                //
                // C1 gate: that uniqueness is only provable when every probe
                // that fed the merged pool (pass 1 + pass 2) succeeded AND
                // returned fewer rows than the cap. A rejected probe or a
                // saturated 50-row window means the sample may hide a second
                // identically-titled record, and auto-resolving one of them
                // into the write body would be a random pick — so on an
                // incomplete sample bestId stays undefined and the
                // partial-match pass below surfaces the candidate as a
                // pendingConfirmation (which blocks the write).
                if (bestId === undefined && hasSingleBracketedNameField(field.referencesEntity)) {
                    const nameFields = getEntityNameFields(field.referencesEntity);
                    const nameMatchPool = allPool ?? await fetchReferenceCandidates(helper, field.referencesEntity, label, false);
                    const allForNameMatch = nameMatchPool.rows;
                    const mergedById = new Map<string | number, IDataObject>();

                    for (const entity of activeCandidates) {
                        const data = entity as unknown as IDataObject;
                        const id = data.id as string | number | undefined;
                        if (id !== undefined) {
                            mergedById.set(id, data);
                        }
                    }
                    for (const entity of allForNameMatch) {
                        const data = entity as unknown as IDataObject;
                        const id = data.id as string | number | undefined;
                        if (id !== undefined && !mergedById.has(id)) {
                            mergedById.set(id, data);
                        }
                    }

                    const nameFieldMatchId = findUniqueNameFieldMatchId(
                        Array.from(mergedById.values()),
                        label,
                        nameFields,
                    );
                    if (nameFieldMatchId !== undefined) {
                        const nameMatchProbeIncomplete =
                            !poolIsComplete(activePool) || !poolIsComplete(nameMatchPool);
                        if (nameMatchProbeIncomplete) {
                            // x3 V1: a pass-1/pass-2 pool gate may already have
                            // warned for this field — keep it to one warning.
                            if (!incompleteWarned) {
                                incompleteWarned = true;
                                warnings.push(
                                    `[NAME_POOL_INCOMPLETE] Uniqueness of '${label}' for field '${field.id}' (${field.referencesEntity}) ` +
                                    'could not be verified — the candidate sample was incomplete (a probe failed or hit its row cap). ' +
                                    'Confirm the record or supply the numeric ID.',
                                );
                            }
                        } else {
                            bestId = nameFieldMatchId;
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

                    // Reuse allPool from Pass 2 (set whenever bestId is still
                    // undefined — Pass 2 always ran by here)
                    const partialsPool = allPool ?? await fetchReferenceCandidates(helper, field.referencesEntity, label, false);
                    const allForPartials = partialsPool.rows;
                    for (const entity of allForPartials) {
                        const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                        const id = (entity as unknown as IDataObject).id as string | number;
                        if (display && display.toLowerCase().includes(label.toLowerCase()) && !seenIds.has(id)) {
                            seenIds.add(id);
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
                    const hint = REFERENCE_RESOLUTION_HINTS[field.referencesEntity] ?? '';
                    warnings.push(`Could not resolve reference label '${label}' for field '${field.id}' (${field.referencesEntity})${hint ? ` ${hint}` : ''}`);
                }
            } catch (err) {
                // Infrastructure-aware error classification
                const msg = (err as Error).message ?? String(err);
                const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
                warnings.push(
                    isInfra
                        ? `[INFRASTRUCTURE] Resolution failed for field '${field.id}' (${field.referencesEntity}): ${msg}. Value sent as-is.`
                        : `Resolution error for field '${field.id}': ${msg}`,
                );
            }
        // Unknown entity type for reference field
        } else if (field.isReference && !field.referencesEntity) {
            // Uniform "Could not resolve ... for field 'X'" wording (v2.28.5) so the
            // write-guard's field-name regex extracts the field instead of reporting
            // '[general-resolution-failure]'.
            warnings.push(
                `Could not resolve reference label for field '${field.id}' (no known entity type) — provide a numeric ID directly, ` +
                `or use autotask_${resource} with operation 'describeFields' to inspect.`,
            );
        }
    }

    // Belt-and-suspenders: drop companion fields from resolved values in case
    // buildFieldValues's exclude set was bypassed (e.g. future call sites).
    for (const companionField of TYPED_REFERENCE_COMPANION_FIELDS) {
        delete (values as Record<string, unknown>)[companionField];
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
    readFields: Array<{ id: string; type?: string; isPickList?: boolean; isReference?: boolean; referencesEntity?: string; allowedValues?: Array<{ id: string | number; label: string }> }>,
    siblingValues?: IDataObject,
): Promise<LabelResolutionResult> {
    const values: IDataObject = { [filterField]: filterValue };
    const resolutions: LabelResolution[] = [];
    const warnings: string[] = [];
    const pendingConfirmations: PendingLabelConfirmation[] = [];

    // Handle array values for in/notIn operators on reference/picklist fields.
    // Resolves each string element individually; keeps numeric/boolean elements as-is.
    const field = readFields.find(f => f.id.toLowerCase() === filterField.toLowerCase());
    const inferredReferenceEntity = inferReferenceEntityFromField(filterField, resource);
    const hasReferenceFallback =
        Boolean(inferredReferenceEntity) &&
        (!field || (!field.isPickList && !field.isReference));

    if (Array.isArray(filterValue)) {
        if ((!field || (!field.isPickList && !field.isReference)) && !hasReferenceFallback) {
            return { values, resolutions, warnings, pendingConfirmations };
        }
        const hasStringLabels = filterValue.some(v => typeof v === 'string' && !isLikelyId(v));
        if (!hasStringLabels) {
            return { values, resolutions, warnings, pendingConfirmations };
        }

        const resolvedArray: Array<string | number | boolean> = [];
        const unresolvedLabels: string[] = [];

        for (const element of filterValue) {
            if (typeof element !== 'string' || isLikelyId(element)) {
                resolvedArray.push(element as string | number | boolean);
                continue;
            }
            const elementResult = await resolveFilterLabelsToIds(
                context,
                resource,
                filterField,
                element,
                readFields,
                siblingValues,
            );
            if (elementResult.resolutions.length > 0) {
                resolvedArray.push(elementResult.values[filterField] as string | number);
                resolutions.push(...elementResult.resolutions);
            } else {
                resolvedArray.push(element);
                unresolvedLabels.push(`'${element}'`);
            }
            warnings.push(...elementResult.warnings);
            pendingConfirmations.push(...elementResult.pendingConfirmations);
        }

        if (unresolvedLabels.length > 0) {
            warnings.push(
                `Could not resolve ${unresolvedLabels.length} in/notIn filter element(s) for '${filterField}': ${unresolvedLabels.join(', ')}`,
            );
        }
        values[filterField] = resolvedArray;
        return { values, resolutions, warnings, pendingConfirmations };
    }

    // Only attempt resolution on string values (not numbers, booleans)
    if (typeof filterValue !== 'string' || filterValue.trim() === '') {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    if (isLikelyId(filterValue)) {
        if (typeof filterValue === 'string' && (field?.isPickList || field?.isReference || hasReferenceFallback)) values[filterField] = Number(filterValue);
        return { values, resolutions, warnings, pendingConfirmations };
    }

    // Find the field metadata in read fields
    if (!field && !hasReferenceFallback) {
        return { values, resolutions, warnings, pendingConfirmations };
    }

    const label = filterValue.trim();

    // Picklist resolution — also fires for integer-type fields with text values, as Autotask
    // sometimes returns isPickList: false for fields that have picklist values (e.g. status, priority).
    const integerLikeTypes = new Set(['integer', 'number', 'long', 'decimal', 'double']);
    const isIntegerFieldWithTextValue =
        !!field &&
        !field.isPickList &&
        !field.isReference &&
        integerLikeTypes.has((field.type ?? '').toLowerCase());
    if (field?.isPickList || isIntegerFieldWithTextValue) {
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
                    } else {
                        const available = result.values.slice(0, 10).map(v => v.label).join(', ');
                        warnings.push(
                            `Picklist filter value '${label}' for '${filterField}' not found. ` +
                            `Available: ${available}${result.values.length > 10 ? '...' : ''}. ` +
                            `Use one of these labels or the numeric ID directly.`,
                        );
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
    const referenceEntity = field?.isReference ? field.referencesEntity : undefined;
    const effectiveReferenceEntity = referenceEntity ?? (hasReferenceFallback ? inferredReferenceEntity : undefined);
    if (effectiveReferenceEntity) {
        // Typed-reference fast path (ticket numbers, project numbers, etc.).
        // siblingValues is undefined on standard-node call sites; resolver falls back to strategy.defaultSearchField.
        const typed = await tryResolveTypedReference(
            context,
            effectiveReferenceEntity,
            label,
            siblingValues ?? {},
        );
        if (typed.status === 'resolved') {
            values[filterField] = typed.id;
            resolutions.push({
                field: filterField,
                from: label,
                to: typed.id,
                method: 'reference',
            });
            return { values, resolutions, warnings, pendingConfirmations };
        }
        if (typed.status === 'pending') {
            pendingConfirmations.push({
                field: filterField,
                label,
                candidates: typed.candidates,
                fieldType: 'reference',
            });
            return { values, resolutions, warnings, pendingConfirmations };
        }
        if (typed.status === 'miss') {
            warnings.push(typed.warning);
            return { values, resolutions, warnings, pendingConfirmations };
        }
        // 'skip' → fall through to existing EntityValueHelper path (unchanged).
        try {
            const helper = new EntityValueHelper(context, effectiveReferenceEntity);

            // Pass 1: Active entities
            const activePool = await fetchReferenceCandidates(helper, effectiveReferenceEntity, label, true);
            const activeCandidates = activePool.rows;
            let allPool: ReferenceCandidatePool | undefined;
            let allCandidates: Array<Record<string, unknown>> | undefined;
            let bestId: string | number | undefined;
            // C1: whether any pool fetched for this label is incomplete —
            // surfaced as a warning below (the read path keeps its
            // auto-resolution; only the write path gates on completeness).
            let probeIncomplete = !poolIsComplete(activePool);

            for (const entity of activeCandidates) {
                const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                if (display && display.toLowerCase() === label.toLowerCase()) {
                    bestId = (entity as unknown as IDataObject).id as string | number;
                    break;
                }
            }

            // No exact match in active set — try Pass 2 (all entities including inactive)
            if (bestId === undefined) {
                allPool = await fetchReferenceCandidates(helper, effectiveReferenceEntity, label, false);
                allCandidates = allPool.rows;
                if (!poolIsComplete(allPool)) probeIncomplete = true;

                for (const entity of allCandidates) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    if (display && display.toLowerCase() === label.toLowerCase()) {
                        bestId = (entity as unknown as IDataObject).id as string | number;
                        break;
                    }
                }
            }

            // Individual nameField matching, beyond the formatted display-name
            // passes above. Two entity classes need it:
            //   - multi-name-field entities (Resource/Contact: firstName +
            //     lastName), where the label may match a single field exactly
            //     even though the full display name ("Max Soukhomlinov") doesn't
            //     match the partial label ("Max");
            //   - v2.29.x (R9): single-name-field entities with a bracket field
            //     (ConfigurationItem: "Server (CI-123)"), where a bare title
            //     label can never equal the formatted display.
            // Auto-resolves only when exactly one entity matches on any nameField.
            const nameFields = getEntityNameFields(effectiveReferenceEntity);
            if (
                bestId === undefined &&
                (nameFields.length >= 2 || hasSingleBracketedNameField(effectiveReferenceEntity))
            ) {
                const nameMatchPool = allPool ?? await fetchReferenceCandidates(helper, effectiveReferenceEntity, label, false);
                if (!poolIsComplete(nameMatchPool)) probeIncomplete = true;
                const allForNameMatch = nameMatchPool.rows;
                const mergedById = new Map<string | number, IDataObject>();

                for (const entity of activeCandidates) {
                    const data = entity as unknown as IDataObject;
                    const id = data.id as string | number | undefined;
                    if (id !== undefined) {
                        mergedById.set(id, data);
                    }
                }
                for (const entity of allForNameMatch) {
                    const data = entity as unknown as IDataObject;
                    const id = data.id as string | number | undefined;
                    if (id !== undefined && !mergedById.has(id)) {
                        mergedById.set(id, data);
                    }
                }

                const nameFieldMatchId = findUniqueNameFieldMatchId(
                    Array.from(mergedById.values()),
                    label,
                    nameFields,
                );
                if (nameFieldMatchId !== undefined) {
                    bestId = nameFieldMatchId;
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

                // Reuse allPool from Pass 2 (set whenever bestId is still
                // undefined — Pass 2 always ran by here)
                const partialsPool = allPool ?? await fetchReferenceCandidates(helper, effectiveReferenceEntity, label, false);
                if (!poolIsComplete(partialsPool)) probeIncomplete = true;
                const allForPartials = partialsPool.rows;
                for (const entity of allForPartials) {
                    const display = helper.getEntityDisplayName(entity as unknown as IDataObject);
                    const id = (entity as unknown as IDataObject).id as string | number;
                    if (display && display.toLowerCase().includes(label.toLowerCase()) && !seenIds.has(id)) {
                        seenIds.add(id);
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

                // Read filters are non-mutating, so when there is exactly one candidate
                // we can safely promote it to an auto-resolution to avoid extra LLM turns.
                const latestPending = pendingConfirmations[pendingConfirmations.length - 1];
                if (
                    latestPending &&
                    latestPending.field === filterField &&
                    new Set(latestPending.candidates.map((candidate) => String(candidate.id))).size === 1
                ) {
                    bestId = latestPending.candidates[0].id;
                    pendingConfirmations.pop();
                }
            }

            if (bestId !== undefined) {
                values[filterField] = bestId;
                resolutions.push({ field: filterField, from: label, to: bestId, method: 'reference' });
            } else if (pendingConfirmations.length === 0) {
                warnings.push(`Could not resolve reference filter label '${label}' for field '${filterField}' (${effectiveReferenceEntity})`);
            }

            // C1: the candidate pool for this label was an incomplete sample
            // (a probe failed or saturated at the row cap) — the resolution /
            // candidate set above may not cover the full population, so flag
            // it instead of presenting it as complete.
            if (probeIncomplete) {
                warnings.push(
                    `[NAME_POOL_INCOMPLETE] Reference filter candidate sample for '${label}' on '${filterField}' ` +
                    `(${effectiveReferenceEntity}) was incomplete (a probe failed or hit its row cap) — the match above ` +
                    'may not be the only one; prefer the numeric ID when in doubt.',
                );
            }
        } catch (err) {
            const msg = (err as Error).message ?? String(err);
            const isInfra = /timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|401|403|unauthorized|forbidden|socket/i.test(msg);
            warnings.push(
                isInfra
                    ? `[INFRASTRUCTURE] Filter resolution failed for '${filterField}' (${effectiveReferenceEntity}): ${msg}. Value sent as-is.`
                    : `Filter resolution error for '${filterField}': ${msg}`,
            );
        }
    } else if (field?.isReference && !field.referencesEntity) {
        // Uniform "Could not resolve ... for field 'X'" wording (v2.28.5) so field
        // names are extractable in resolution-state summaries (read path).
        warnings.push(
            `Could not resolve reference filter label for field '${filterField}' (no known entity type) — provide a numeric ID directly, ` +
            `or use autotask_${resource} with operation 'describeFields' to inspect.`,
        );
    }

    return { values, resolutions, warnings, pendingConfirmations };
}
