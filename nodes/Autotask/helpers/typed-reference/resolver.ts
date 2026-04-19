import type { IExecuteFunctions } from 'n8n-workflow';
import type { IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from '../http/request';
import { extractItems } from '../dedup-utils';
import { isLikelyId } from '../id-utils';
import { TYPED_REFERENCE_STRATEGIES } from './strategies';
import type { TypedReferenceStrategy, TypedResolutionOutcome } from './types';

const MAX_CANDIDATES = 10;

export async function tryResolveTypedReference(
    ctx: IExecuteFunctions,
    entityType: string,
    label: string,
    siblingValues: IDataObject,
): Promise<TypedResolutionOutcome> {
    const strategy = TYPED_REFERENCE_STRATEGIES[entityType.toLowerCase()];
    if (!strategy) return { status: 'skip' };
    // Belt-and-suspenders: caller already guards with isLikelyId.
    if (isLikelyId(label)) return { status: 'skip' };

    // Path A: regex match → exact numberField lookup
    if (strategy.numberPattern?.test(label)) {
        const result = await queryExact(ctx, strategy, label);
        if (result.length === 1) {
            return { status: 'resolved', id: result[0].id as string | number, method: 'number-exact' };
        }
        return {
            status: 'miss',
            warning: `No ${strategy.entityType} found with ${strategy.numberField} = '${label}'`,
        };
    }

    // Path B: non-regex, non-numeric → try numberField eq first (project pattern)
    if (!strategy.numberPattern) {
        const result = await queryExact(ctx, strategy, label);
        if (result.length === 1) {
            return { status: 'resolved', id: result[0].id as string | number, method: 'number-exact' };
        }
        // fall through to companion/default search
    }

    // Path C: companion or default search field
    const companionValue = siblingValues[strategy.companionFieldName];
    const searchField =
        typeof companionValue === 'string' && strategy.searchableFields.includes(companionValue)
            ? companionValue
            : strategy.defaultSearchField;

    if (!searchField) {
        return {
            status: 'miss',
            warning:
                `Could not resolve '${label}' as ${strategy.entityType} ${strategy.numberField}. ` +
                `Supply a numeric ID or use ${strategy.companionFieldName} to specify a search field.`,
        };
    }

    const candidates = await querySearch(ctx, strategy, searchField, label);
    if (candidates.length === 1) {
        return { status: 'resolved', id: candidates[0].id as string | number, method: 'search-unique' };
    }
    if (candidates.length > 1) {
        return {
            status: 'pending',
            candidates: candidates.slice(0, MAX_CANDIDATES).map((e) => ({
                id: e.id as string | number,
                displayName: strategy.formatCandidateDisplayName(e),
            })),
        };
    }
    return {
        status: 'miss',
        warning: `No ${strategy.entityType} found where ${searchField} contains '${label}'`,
    };
}

async function queryExact(
    ctx: IExecuteFunctions,
    strategy: TypedReferenceStrategy,
    value: string,
): Promise<IDataObject[]> {
    const includeFields = ['id', strategy.numberField];
    if (strategy.defaultSearchField) includeFields.push(strategy.defaultSearchField);
    const resp = await autotaskApiRequest.call(ctx, 'POST', strategy.queryEndpoint, {
        filter: [{ field: strategy.numberField, op: 'eq', value }],
        IncludeFields: includeFields,
        MaxRecords: 2,
    });
    return extractItems(resp as IDataObject);
}

async function querySearch(
    ctx: IExecuteFunctions,
    strategy: TypedReferenceStrategy,
    field: string,
    value: string,
): Promise<IDataObject[]> {
    const includeFields = ['id', strategy.numberField];
    if (strategy.defaultSearchField) includeFields.push(strategy.defaultSearchField);
    const resp = await autotaskApiRequest.call(ctx, 'POST', strategy.queryEndpoint, {
        filter: [{ field, op: 'contains', value }],
        IncludeFields: includeFields,
        MaxRecords: MAX_CANDIDATES + 1,
    });
    return extractItems(resp as IDataObject);
}
