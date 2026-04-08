import type { IAutotaskCredentials } from '../types/base/auth';

const FIELD_INDICES = [1, 2, 3, 4, 5] as const;
const FALLBACKS = ['field1', 'field2', 'field3', 'field4', 'field5'] as const;

function normaliseAlias(raw: string, fallback: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const safe = trimmed
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return safe || fallback;
}

export function buildAliasMap(credentials: IAutotaskCredentials): Map<number, string> {
    const rawAliases: string[] = [
        credentials.changeInfoField1Alias ?? 'issueBusinessImpact',
        credentials.changeInfoField2Alias ?? 'changesToBeMade',
        credentials.changeInfoField3Alias ?? 'implementationPlan',
        credentials.changeInfoField4Alias ?? 'reversionPlan',
        credentials.changeInfoField5Alias ?? 'risksInvolved',
    ];

    // First pass: normalise all tokens
    const tokens = rawAliases.map((raw, i) => normaliseAlias(raw, FALLBACKS[i]));

    // Second pass: deduplicate — suffix collisions with _2, _3, etc.
    const usedTokens = new Map<string, number>(); // base token -> next suffix
    const finalTokens: string[] = [];

    for (const token of tokens) {
        if (!usedTokens.has(token)) {
            usedTokens.set(token, 2); // next occurrence gets _2
            finalTokens.push(token);
        } else {
            const suffix = usedTokens.get(token)!;
            usedTokens.set(token, suffix + 1);
            finalTokens.push(`${token}_${suffix}`);
        }
    }

    const aliasMap = new Map<number, string>();
    for (let i = 0; i < FIELD_INDICES.length; i++) {
        aliasMap.set(FIELD_INDICES[i], finalTokens[i]);
    }
    return aliasMap;
}

export function applyChangeInfoAliases(
    entity: Record<string, unknown>,
    aliasMap: Map<number, string>,
): void {
    for (const [n, alias] of aliasMap) {
        const sourceKey = `changeInfoField${n}`;
        if (sourceKey in entity) {
            entity[`${sourceKey}_${alias}`] = entity[sourceKey];
        }
    }
}

export function shouldApplyAliases(credentials: IAutotaskCredentials): boolean {
    return credentials.includeChangeInfoAliasesInOutput === true;
}
