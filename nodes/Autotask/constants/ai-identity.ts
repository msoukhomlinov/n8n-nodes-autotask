import { AUTOTASK_ENTITIES } from './entities';
import { PICKLIST_REFERENCE_FIELD_MAPPINGS } from './field.constants';

export interface AiIdentityParentProfile {
    resource: string;
    idField: string;
}

export interface AiIdentityProfile {
    primaryIdFields?: string[];
    humanIdentifierFields?: string[];
    titleLikeFields?: string[];
    parent?: AiIdentityParentProfile;
    hint?: string;
}

// Keep overrides minimal: only add entries when derivation needs a deliberate hint.
const PROFILE_OVERRIDES: Record<string, AiIdentityProfile> = {
    ticket: {
        hint: 'Identity: ticket number + title when available.',
    },
    timeEntry: {
        hint: 'Identity includes parent context when available.',
    },
};

function lowerCamelCase(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function toResourceKey(entity: { name: string; resourceKey?: string }): string {
    return entity.resourceKey ?? lowerCamelCase(entity.name);
}

function normaliseFields(values: Array<string | undefined> | undefined): string[] {
    if (!values) return [];
    const unique = new Set<string>();
    for (const value of values) {
        if (!value) continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        unique.add(trimmed);
    }
    return [...unique];
}

function deriveProfileFromMappings(resource: string): AiIdentityProfile {
    const entityName = AUTOTASK_ENTITIES.find((entity) => toResourceKey(entity) === resource)?.name;
    const fieldMapping = entityName ? PICKLIST_REFERENCE_FIELD_MAPPINGS[entityName] : undefined;
    // Most entities expose `id`; some also use an entity-specific `xxxID` field in payloads.
    const inferredEntityIdField = entityName ? `${lowerCamelCase(entityName)}ID` : undefined;

    const bracketFields = Array.isArray(fieldMapping?.bracketField) ? fieldMapping.bracketField : [];
    const nameFields = Array.isArray(fieldMapping?.nameFields) ? fieldMapping.nameFields : [];

    return {
        primaryIdFields: normaliseFields(['id', inferredEntityIdField]),
        humanIdentifierFields: normaliseFields(bracketFields),
        titleLikeFields: normaliseFields(nameFields),
    };
}

function deriveParent(resource: string): AiIdentityParentProfile | undefined {
    const metadata = AUTOTASK_ENTITIES.find((entity) => toResourceKey(entity) === resource);
    if (!metadata) return undefined;
    if (!metadata.parentIdField || !metadata.childOf) return undefined;
    const parentEntity = AUTOTASK_ENTITIES.find((entity) => entity.name === metadata.childOf);
    if (!parentEntity) return undefined;
    return {
        resource: toResourceKey(parentEntity),
        idField: metadata.parentIdField,
    };
}

const PROFILE_CACHE = new Map<string, AiIdentityProfile>();

export function getAiIdentityProfile(resource: string): AiIdentityProfile {
    const cached = PROFILE_CACHE.get(resource);
    if (cached) return cached;

    const derived = deriveProfileFromMappings(resource);
    const parent = PROFILE_OVERRIDES[resource]?.parent ?? deriveParent(resource);
    const explicit = PROFILE_OVERRIDES[resource] ?? {};

    const profile: AiIdentityProfile = {
        primaryIdFields: normaliseFields([...(derived.primaryIdFields ?? []), ...(explicit.primaryIdFields ?? [])]),
        humanIdentifierFields: normaliseFields([
            ...(derived.humanIdentifierFields ?? []),
            ...(explicit.humanIdentifierFields ?? []),
        ]),
        titleLikeFields: normaliseFields([...(derived.titleLikeFields ?? []), ...(explicit.titleLikeFields ?? [])]),
        ...(parent ? { parent } : {}),
        ...(explicit.hint ? { hint: explicit.hint } : {}),
    };

    PROFILE_CACHE.set(resource, profile);
    return profile;
}

export function getAiIdentityHint(resource: string): string | undefined {
    return getAiIdentityProfile(resource).hint;
}
