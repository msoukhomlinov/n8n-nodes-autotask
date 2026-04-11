import type { FieldMeta } from '../helpers/aiHelper';
import type {
    LabelResolution,
    PendingLabelConfirmation,
} from '../helpers/label-resolution';
import { getAiIdentityProfile, type AiIdentityParentProfile } from '../constants/ai-identity';
import type {
    PaginationInfo,
    ResultFlags,
    ResultKind,
    ResultPayload,
} from './error-formatter';

export interface ToolResponseContext {
    resource?: string;
    recencyActive?: boolean;
    recencyWindowLimited?: boolean;
    recencyNote?: string;
    resolutions?: LabelResolution[];
    resolutionWarnings?: string[];
    pendingConfirmations?: PendingLabelConfirmation[];
    effectiveOffset?: number;
    readFields?: FieldMeta[];
}

export function attachCorrelation(json: string, id: string | undefined): string {
    if (!id) return json;
    try {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        return JSON.stringify({ correlationId: id, ...parsed });
    } catch {
        return json;
    }
}

export function buildResultPayload(
    kind: ResultKind,
    data: unknown,
    flags: Partial<Omit<ResultFlags, 'needsUserConfirmation' | 'safeToContinue'>>,
    extras: {
        resource?: string;
        operation?: string;
        readFields?: FieldMeta[];
        warnings?: string[];
        pendingConfirmations?: PendingLabelConfirmation[];
        appliedResolutions?: LabelResolution[];
        pagination?: PaginationInfo;
        notes?: string[];
    } = {},
): ResultPayload {
    const pendingConfirmations = extras.pendingConfirmations ?? [];
    const warnings = extras.warnings ?? [];
    const appliedResolutions = extras.appliedResolutions ?? [];
    const needsUserConfirmation = pendingConfirmations.length > 0;
    const partial = flags.partial ?? false;

    const meaningfulIdentity = buildMeaningfulIdentity(
        kind,
        data,
        extras.resource,
        extras.readFields,
    );

    return {
        kind,
        data,
        flags: {
            mutated: flags.mutated ?? false,
            retryable: flags.retryable ?? true,
            partial,
            truncated: flags.truncated ?? false,
            needsUserConfirmation,
            safeToContinue: !needsUserConfirmation && !partial,
            ...(flags.dryRunOnly ? { dryRunOnly: true } : {}),
        },
        warnings,
        pendingConfirmations,
        appliedResolutions,
        ...(meaningfulIdentity ? { meaningfulIdentity } : {}),
        ...(extras.pagination ? { pagination: extras.pagination } : {}),
        ...(extras.notes?.length ? { notes: extras.notes } : {}),
    };
}

interface IdentitySummary {
    id?: string | number;
    humanIdentifier?: string | number;
    title?: string;
    label?: string;
}

interface ParentIdentitySummary {
    resource: string;
    idField: string;
    id?: string | number;
    label?: string;
}

interface RecordIdentitySummary extends IdentitySummary {
    parent?: ParentIdentitySummary;
}

function getFieldValue(
    entity: Record<string, unknown>,
    fields: string[],
): string | number | undefined {
    for (const field of fields) {
        const value = entity[field];
        if (
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim() !== '')
        ) {
            return value;
        }
    }
    return undefined;
}

function getFieldValueByKeyPattern(
    entity: Record<string, unknown>,
    pattern: RegExp,
): string | number | undefined {
    // Pattern fallback keeps identity extraction resilient when schema-selected fields vary.
    for (const [key, value] of Object.entries(entity)) {
        if (!pattern.test(key)) continue;
        if (
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim() !== '')
        ) {
            return value;
        }
    }
    return undefined;
}

function toText(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return undefined;
}

function buildRecordIdentity(
    resource: string,
    entity: Record<string, unknown>,
    readFields?: FieldMeta[],
): RecordIdentitySummary | undefined {
    const profile = getAiIdentityProfile(resource);
    // Use profile-first fields, then structural key patterns as a safe fallback.
    const id =
        getFieldValue(entity, profile.primaryIdFields ?? []) ??
        getFieldValueByKeyPattern(entity, /(^id$|Id$|ID$)/);
    const humanIdentifier = getFieldValue(
        entity,
        profile.humanIdentifierFields ?? [],
    ) ?? getFieldValueByKeyPattern(entity, /Number$|Code$|Reference$/i);
    const titleValue =
        getFieldValue(entity, profile.titleLikeFields ?? []) ??
        getFieldValueByKeyPattern(entity, /Name$|Title$|Subject$|DisplayName$/i);
    const label = toText(humanIdentifier) && toText(titleValue)
        ? `${toText(humanIdentifier)} - ${toText(titleValue)}`
        : toText(humanIdentifier) ?? toText(titleValue);

    // Prefer explicit profile parent; otherwise infer from reference field metadata.
    const inferredParent = resolveParentProfile(entity, readFields);
    const parentProfile = profile.parent ?? inferredParent;
    let parent: ParentIdentitySummary | undefined;
    if (parentProfile) {
        const parentIdRaw = entity[parentProfile.idField];
        const parentId = (typeof parentIdRaw === 'number' || typeof parentIdRaw === 'string')
            ? parentIdRaw
            : undefined;
        const parentLabelField = `${parentProfile.idField}_label`;
        const parentLabel = toText(entity[parentLabelField]);
        if (parentId !== undefined || parentLabel) {
            parent = {
                resource: parentProfile.resource,
                idField: parentProfile.idField,
                ...(parentId !== undefined ? { id: parentId } : {}),
                ...(parentLabel ? { label: parentLabel } : {}),
            };
        }
    }

    if (id === undefined && !label && !parent) return undefined;
    return {
        ...(id !== undefined ? { id } : {}),
        ...(humanIdentifier !== undefined ? { humanIdentifier } : {}),
        ...(titleValue !== undefined ? { title: String(titleValue) } : {}),
        ...(label ? { label } : {}),
        ...(parent ? { parent } : {}),
    };
}

function buildMeaningfulIdentity(
    kind: ResultKind,
    data: unknown,
    resource: string | undefined,
    readFields?: FieldMeta[],
): Record<string, unknown> | undefined {
    if (!resource) return undefined;

    if (kind === 'item' || kind === 'summary') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
        const identity = buildRecordIdentity(resource, data as Record<string, unknown>, readFields);
        return identity ? { mode: 'single', ...identity } : undefined;
    }

    if (kind === 'list') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
        const items = (data as Record<string, unknown>).items;
        if (!Array.isArray(items)) return undefined;
        const identities = items
            .map((item) =>
                item && typeof item === 'object' && !Array.isArray(item)
                    ? buildRecordIdentity(resource, item as Record<string, unknown>, readFields)
                    : undefined,
            )
            .filter((entry): entry is RecordIdentitySummary => entry !== undefined);
        if (identities.length === 0) return undefined;
        return {
            mode: 'list',
            count: identities.length,
            items: identities,
        };
    }

    if (kind === 'mutation') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
        const mutationData = data as Record<string, unknown>;
        const entity = mutationData.entity;
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
            const idValue = mutationData.id;
            if (typeof idValue === 'number' || typeof idValue === 'string') {
                return { mode: 'mutation', id: idValue };
            }
            return undefined;
        }
        const identity = buildRecordIdentity(resource, entity as Record<string, unknown>, readFields);
        return identity ? { mode: 'mutation', ...identity } : undefined;
    }

    return undefined;
}

function resolveParentProfile(
    entity: Record<string, unknown>,
    readFields?: FieldMeta[],
): AiIdentityParentProfile | undefined {
    if (!readFields || readFields.length === 0) return undefined;
    for (const field of readFields) {
        // Parent inference is metadata-driven: reference fields ending in `ID` with a value present.
        if (!field.isReference || !field.referencesEntity) continue;
        if (!field.id.toLowerCase().endsWith('id')) continue;
        const value = entity[field.id];
        if (value === undefined || value === null || value === '') continue;
        const resource =
            field.referencesEntity.charAt(0).toLowerCase() + field.referencesEntity.slice(1);
        return {
            resource,
            idField: field.id,
        };
    }
    return undefined;
}
