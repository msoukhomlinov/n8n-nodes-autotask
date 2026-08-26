import moment from 'moment-timezone';
import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { mapFilterOp } from './schema-generator';
import { getReferencedEntity, listPicklistValues, type FieldMeta } from '../helpers/aiHelper';
import {
    resolveFilterLabelsToIds,
    type LabelResolution,
    type PendingLabelConfirmation,
} from '../helpers/label-resolution';
import { isLikelyId } from '../helpers/id-utils';
import { resolveCredentialIdentity } from '../helpers/cache/service';
import { resolveFilterFieldAlias } from '../constants/filter-field-aliases';
import { autotaskApiRequest } from '../helpers/http';
import {
    wrapError,
    ERROR_TYPES,
    type FlatErrorResponse,
} from './error-formatter';
import type { IAutotaskEntity } from '../types';

export interface ToolFilter {
    field: string;
    op: string;
    value?: string | number | boolean | Array<string | number | boolean>;
    udf?: boolean;
    /** Original field name supplied by the model when an alias was applied. */
    aliasedFrom?: string;
}

export interface FilterResolutionResult {
    filters: ToolFilter[];
    resolutions: LabelResolution[];
    warnings: string[];
    pendingConfirmations: PendingLabelConfirmation[];
    unresolvedIdLikeFilters: ToolFilter[];
    unresolvedIdLikeFilterDetails: Array<{
        field: string;
        unresolvedElements: Array<string | number | boolean>;
    }>;
    unresolvedPicklistFilters: ToolFilter[];
    unresolvedPicklistFilterDetails: Array<{
        field: string;
        attemptedValue: string;
        availableValues: string[];
    }>;
}

/**
 * S4: a value-bearing filter op (anything except exist/notExist) was given an
 * empty filter_value — undefined, '', or whitespace-only. Thrown by
 * buildFilterFromParams and rendered as a flat INVALID_FILTER_CONSTRAINT
 * envelope by tool-executor (previously the filter was silently dropped and
 * the query ran unfiltered, or whitespace coerced to 0 on numeric fields).
 * Numeric 0 and boolean false are legitimate values and never trigger this.
 */
export class EmptyFilterValueError extends Error {
    constructor(
        public readonly field: string,
        public readonly op: string,
    ) {
        super(`filter_value is empty for field '${field}' (op '${op}').`);
        this.name = 'EmptyFilterValueError';
    }
}

/**
 * S4/F-5: undefined, null, '', whitespace-only strings, and the literal
 * 'null' string are all "empty" filter values. (F-5: `filter_value: null` used
 * to coerce to 0 on numeric columns and the literal string 'null' reached the
 * API as raw varchar — both silent-wrong.) Numeric 0 and boolean false are
 * legitimate values and never trigger this.
 */
function isBlankFilterValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' || trimmed.toLowerCase() === 'null';
    }
    return false;
}

interface ToolExecutorFilterParams {
    filter_field?: string;
    filter_op?: string;
    filter_value?: string | number | boolean | Array<string | number | boolean>;
    filter_field_2?: string;
    filter_op_2?: string;
    filter_value_2?: string | number | boolean | Array<string | number | boolean>;
}

export function buildFieldLookup(fields: FieldMeta[]): Map<string, FieldMeta> {
    return new Map(fields.map((field) => [field.id.toLowerCase(), field]));
}

export function coerceFilterValueByFieldType(
    value: string | number | boolean | Array<string | number | boolean>,
    fieldType: string | undefined,
    operator: string,
): string | number | boolean | Array<string | number | boolean> {
    const normalisedType = (fieldType ?? '').toLowerCase();
    const toTypedScalar = (input: string | number | boolean): string | number | boolean => {
        // Options fields (isBilled, isBillableToCompany, isAnnouncement, etc.) store boolean 0/1.
        // Coerce bool and canonical string representations to numeric so the API never receives
        // a varchar like "false" or a JS boolean that causes a type-conversion error.
        if (normalisedType === 'options') {
            if (typeof input === 'boolean') return input ? 1 : 0;
            if (typeof input === 'string') {
                const lower = input.toLowerCase();
                if (lower === 'true' || lower === '1') return 1;
                if (lower === 'false' || lower === '0') return 0;
            }
            return input; // numeric values and label strings pass through unchanged
        }
        if (typeof input === 'number' || typeof input === 'boolean') {
            return input;
        }
        if (normalisedType === 'number') {
            const parsed = Number(input);
            return Number.isFinite(parsed) ? parsed : input;
        }
        if (normalisedType === 'boolean') {
            if (input.toLowerCase() === 'true') return true;
            if (input.toLowerCase() === 'false') return false;
        }
        return input;
    };

    if (operator === 'in' || operator === 'notIn') {
        if (Array.isArray(value)) {
            return value.map((v) => toTypedScalar(v));
        }
        if (typeof value === 'string' && value.includes(',')) {
            return value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
                .map((v) => toTypedScalar(v));
        }
        return [toTypedScalar(value)];
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? toTypedScalar(value[0]) : '';
    }
    return toTypedScalar(value);
}

export function buildFilterFromParams(
    params: ToolExecutorFilterParams,
    readFields: FieldMeta[],
    timezone: string,
    resource?: string,
): ToolFilter[] {
    const filters: ToolFilter[] = [];
    const readFieldLookup = buildFieldLookup(readFields);
    const readFieldIds = readFields.length > 0
        ? new Set(readFields.map((f) => f.id.toLowerCase()))
        : undefined;

    const mappedOp1 = params.filter_op ? mapFilterOp(params.filter_op) : 'eq';
    const isNullCheckOp1 = mappedOp1 === 'exist' || mappedOp1 === 'notExist';
    if (params.filter_field && !isNullCheckOp1 && isBlankFilterValue(params.filter_value)) {
        // S4: reject a blank filter_value up front — the old `!== ''` guard
        // silently dropped the filter (unfiltered query reported as filtered).
        const alias1 = resource
            ? resolveFilterFieldAlias(resource, params.filter_field, readFieldIds)
            : { resolved: params.filter_field };
        const canonicalField1 = readFieldLookup.get(alias1.resolved.toLowerCase());
        throw new EmptyFilterValueError(canonicalField1?.id ?? alias1.resolved, mappedOp1);
    }
    if (
        params.filter_field &&
        (isNullCheckOp1 || !isBlankFilterValue(params.filter_value))
    ) {
        const alias1 = resource
            ? resolveFilterFieldAlias(resource, params.filter_field, readFieldIds)
            : { resolved: params.filter_field };
        const effectiveField1 = alias1.resolved;
        const canonicalField = readFieldLookup.get(effectiveField1.toLowerCase());
        let coercedValue1 = coerceFilterValueByFieldType(
            params.filter_value as string | number | boolean | Array<string | number | boolean>,
            canonicalField?.type,
            mappedOp1,
        );
        if (
            !isNullCheckOp1 &&
            typeof coercedValue1 === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(coercedValue1) &&
            canonicalField?.type?.toLowerCase() === 'datetime'
        ) {
            const converted = moment.tz(coercedValue1, timezone);
            if (converted.isValid()) {
                coercedValue1 = converted
                    .utc()
                    .toISOString()
                    .replace(/\.\d{3}Z$/, 'Z');
            }
        }
        filters.push({
            field: canonicalField?.id ?? effectiveField1,
            op: mappedOp1,
            ...(!isNullCheckOp1 ? { value: coercedValue1 } : {}),
            ...(canonicalField?.udf ? { udf: true } : {}),
            ...(alias1.aliasedFrom ? { aliasedFrom: alias1.aliasedFrom } : {}),
        });
    }

    const mappedOp2 = params.filter_op_2 ? mapFilterOp(params.filter_op_2) : 'eq';
    const isNullCheckOp2 = mappedOp2 === 'exist' || mappedOp2 === 'notExist';
    if (params.filter_field_2 && !isNullCheckOp2 && isBlankFilterValue(params.filter_value_2)) {
        // S4: same as the primary pair — a blank second filter_value is a
        // deliberate error, not a silent drop.
        const alias2 = resource
            ? resolveFilterFieldAlias(resource, params.filter_field_2, readFieldIds)
            : { resolved: params.filter_field_2 };
        const canonicalField2 = readFieldLookup.get(alias2.resolved.toLowerCase());
        throw new EmptyFilterValueError(canonicalField2?.id ?? alias2.resolved, mappedOp2);
    }
    if (
        params.filter_field_2 &&
        (isNullCheckOp2 || !isBlankFilterValue(params.filter_value_2))
    ) {
        const alias2 = resource
            ? resolveFilterFieldAlias(resource, params.filter_field_2, readFieldIds)
            : { resolved: params.filter_field_2 };
        const effectiveField2 = alias2.resolved;
        const canonicalField = readFieldLookup.get(effectiveField2.toLowerCase());
        let coercedValue2 = coerceFilterValueByFieldType(
            params.filter_value_2 as string | number | boolean | Array<string | number | boolean>,
            canonicalField?.type,
            mappedOp2,
        );
        if (
            !isNullCheckOp2 &&
            typeof coercedValue2 === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(coercedValue2) &&
            canonicalField?.type?.toLowerCase() === 'datetime'
        ) {
            const converted = moment.tz(coercedValue2, timezone);
            if (converted.isValid()) {
                coercedValue2 = converted
                    .utc()
                    .toISOString()
                    .replace(/\.\d{3}Z$/, 'Z');
            }
        }
        filters.push({
            field: canonicalField?.id ?? effectiveField2,
            op: mappedOp2,
            ...(!isNullCheckOp2 ? { value: coercedValue2 } : {}),
            ...(canonicalField?.udf ? { udf: true } : {}),
            ...(alias2.aliasedFrom ? { aliasedFrom: alias2.aliasedFrom } : {}),
        });
    }

    return filters;
}

function isLikelyReferenceIdFilterField(
    fieldName: string,
    resource: string,
    readFields: FieldMeta[],
): boolean {
    const lookup = readFields.find((field) => field.id.toLowerCase() === fieldName.toLowerCase());
    if (lookup?.isReference) return true;
    return getReferencedEntity(fieldName, resource) !== undefined;
}

export async function resolveAndClassifyFilters(
    context: IExecuteFunctions,
    resource: string,
    filters: ToolFilter[],
    readFields: FieldMeta[],
    siblingValues?: IDataObject,
): Promise<FilterResolutionResult> {
    const allResolutions: LabelResolution[] = [];
    const allWarnings: string[] = [];
    const allPendingConfirmations: PendingLabelConfirmation[] = [];

    await Promise.all(
        filters.map(async (filter) => {
            if (
                typeof filter.value === 'string' &&
                filter.value.trim() !== '' &&
                !isLikelyId(filter.value)
            ) {
                try {
                    const resolution = await resolveFilterLabelsToIds(
                        context,
                        resource,
                        filter.field,
                        filter.value,
                        readFields,
                        siblingValues,
                    );
                    if (resolution.resolutions.length > 0) {
                        filter.value = resolution.values[filter.field] as string | number | boolean;
                        allResolutions.push(...resolution.resolutions);
                        // When picklist resolution produces a numeric ID, contains/beginsWith ops
                        // are invalid on integer fields — auto-correct to eq.
                        if (typeof filter.value === 'number' &&
                            (filter.op === 'contains' || filter.op === 'beginsWith')) {
                            filter.op = 'eq';
                        }
                    }
                    if (resolution.warnings.length > 0) {
                        allWarnings.push(...resolution.warnings);
                    }
                    if (resolution.pendingConfirmations.length > 0) {
                        allPendingConfirmations.push(...resolution.pendingConfirmations);
                    }
                } catch (err) {
                    allWarnings.push(
                        `Filter label resolution failed for '${filter.field}': ${(err as Error).message}`,
                    );
                }
            } else if (Array.isArray(filter.value)) {
                try {
                    const resolution = await resolveFilterLabelsToIds(
                        context,
                        resource,
                        filter.field,
                        filter.value,
                        readFields,
                        siblingValues,
                    );
                    if (resolution.resolutions.length > 0) {
                        filter.value = resolution.values[filter.field] as Array<
                            string | number | boolean
                        >;
                        allResolutions.push(...resolution.resolutions);
                    }
                    allWarnings.push(...resolution.warnings);
                    allPendingConfirmations.push(...resolution.pendingConfirmations);
                } catch (err) {
                    allWarnings.push(
                        `Filter label resolution failed for '${filter.field}': ${(err as Error).message}`,
                    );
                }
            }
        }),
    );

    const unresolvedIdLikeFilterDetails: Array<{
        field: string;
        unresolvedElements: Array<string | number | boolean>;
    }> = [];
    const unresolvedIdLikeFilters = filters.filter((filter) => {
        if (!isLikelyReferenceIdFilterField(filter.field, resource, readFields)) return false;

        const unresolvedElements: Array<string | number | boolean> = [];
        if (typeof filter.value === 'string') {
            if (filter.value.trim() !== '' && !isLikelyId(filter.value)) {
                unresolvedElements.push(filter.value);
            }
        } else if (Array.isArray(filter.value) && (filter.op === 'in' || filter.op === 'notIn')) {
            for (const element of filter.value) {
                if (typeof element !== 'string') continue;
                if (element.trim() === '') continue;
                if (!isLikelyId(element)) unresolvedElements.push(element);
            }
        }

        if (unresolvedElements.length === 0) return false;
        unresolvedIdLikeFilterDetails.push({
            field: filter.field,
            unresolvedElements: Array.from(new Set(unresolvedElements)),
        });
        return true;
    });
    for (const unresolved of unresolvedIdLikeFilterDetails) {
        allWarnings.push(
            `Unresolved ID-like filter '${unresolved.field}' has non-numeric value(s): ${unresolved.unresolvedElements
                .map((value) => `'${String(value)}'`)
                .join(', ')}.`,
        );
    }

    // Detect picklist filters whose values are still non-numeric strings after resolution
    // (label not found, no pending candidates). Must be blocked before API dispatch to prevent
    // type-conversion errors — e.g. chargeType="material" when only "Operational"/"Capitalized" exist.
    const unresolvedPicklistFilterDetails: Array<{
        field: string;
        attemptedValue: string;
        availableValues: string[];
    }> = [];
    // S1: mirror the resolver's picklist-shaped predicate exactly —
    // resolveFilterLabelsToIds also treats integer-typed fields with text values
    // as picklists (Autotask sometimes reports status/priority with
    // isPickList:false). A text value that survived resolution on any of these
    // fields must never reach the API as a raw varchar.
    const integerLikeTypes = new Set(['integer', 'number', 'long', 'decimal', 'double']);
    const unresolvedPicklistFilters = filters.filter((filter) => {
        const field = readFields.find((f) => f.id.toLowerCase() === filter.field.toLowerCase());
        if (!field) return false;
        const isIntegerFieldWithTextValue =
            !field.isPickList &&
            !field.isReference &&
            integerLikeTypes.has((field.type ?? '').toLowerCase());
        if (!field.isPickList && !isIntegerFieldWithTextValue) return false;
        // NOTE: do NOT exclude pending-confirmation picklist entries here — those partial-match
        // strings are never resolved to IDs and will hit the API as raw varchar values.
        // The blocker below catches both "no match" and "partial match" cases uniformly.
        const availableValues = (field.allowedValues ?? []).map((v) => v.label);

        if (typeof filter.value === 'string') {
            if (filter.value.trim() === '' || isLikelyId(filter.value)) return false;
            unresolvedPicklistFilterDetails.push({ field: filter.field, attemptedValue: filter.value, availableValues });
            return true;
        }

        // in/notIn arrays: resolution is skipped for arrays, so catch non-numeric string elements here
        if (Array.isArray(filter.value) && (filter.op === 'in' || filter.op === 'notIn')) {
            const badElements = (filter.value as Array<string | number | boolean>).filter(
                (el) => typeof el === 'string' && el.trim() !== '' && !isLikelyId(el),
            );
            if (badElements.length === 0) return false;
            for (const el of badElements) {
                unresolvedPicklistFilterDetails.push({ field: filter.field, attemptedValue: String(el), availableValues });
            }
            return true;
        }

        return false;
    });

    return {
        filters,
        resolutions: allResolutions,
        warnings: allWarnings,
        pendingConfirmations: allPendingConfirmations,
        unresolvedIdLikeFilters,
        unresolvedIdLikeFilterDetails,
        unresolvedPicklistFilters,
        unresolvedPicklistFilterDetails,
    };
}

/**
 * S1: block unresolved picklist filters on special-op synthetic filters before
 * API dispatch — the same value class the general getMany path already blocks
 * (resolveAndClassifyFilters detection). Special-op classification:
 *   - partial match (pending candidates exist for a blocked field)
 *     → INVALID_FILTER_CONSTRAINT with pendingConfirmations + mustRetryAfter
 *   - no candidates at all → INVALID_PICKLIST_VALUE + mustRetryAfter
 * Both direct the model to listPicklistValues to re-ground before retrying.
 */
export function buildPicklistFilterBlocker(
	resource: string,
	operation: string,
	details: FilterResolutionResult['unresolvedPicklistFilterDetails'],
	pendingConfirmations: PendingLabelConfirmation[],
): FlatErrorResponse | null {
	if (!details || details.length === 0) return null;
	const summary = details
		.map((d) => {
			const avail = d.availableValues.length > 0 ? d.availableValues.join(', ') : 'none';
			return `'${d.field}'='${d.attemptedValue}' — available: ${avail}`;
		})
		.join('; ');
	const blockedFields = new Set(details.map((d) => d.field));
	const candidates = pendingConfirmations.filter((pc) => blockedFields.has(pc.field));
	const hasCandidates = candidates.length > 0;
	return wrapError(
		resource,
		operation,
		hasCandidates ? ERROR_TYPES.INVALID_FILTER_CONSTRAINT : ERROR_TYPES.INVALID_PICKLIST_VALUE,
		`Picklist filter value(s) not found: ${summary}.`,
		hasCandidates
			? `Partial match candidates found — pick the correct ID from pendingConfirmations, then retry autotask_${resource} with operation '${operation}' using the numeric ID.`
			: `Value not found in the field's picklist. Call autotask_${resource} with operation 'listPicklistValues' to see valid values, then retry operation '${operation}' with one of them or the numeric ID.`,
		{
			unresolvedPicklistFilters: details,
			...(hasCandidates ? { pendingConfirmations: candidates } : {}),
		},
		['listPicklistValues'],
	);
}

/**
 * F-4: a numeric status/priority value on a special-op synthetic filter that is
 * NOT a real picklist ID (e.g. `status: 2` when the picklist has no entry 2)
 * used to sail through the isLikelyId branch straight to the API and return
 * silent zero rows with no signal.
 *
 * Primary branch (implemented here): validate ID-like values against the
 * picklist's ID set — inline `allowedValues` from the field metadata first,
 * else the `listPicklistValues` payload (entries carry ids), cached per
 * resource+field for 5 minutes. Unknown integer → `INVALID_PICKLIST_VALUE`
 * with the available `id:label` list and the `listPicklistValues` directive.
 *
 * Fallback branch: when the picklist payload carries no ids (or the metadata
 * lookup fails), the numeric value passes through and is reported in
 * `unvalidatedNumericFilters` — the handler appends a
 * "numeric <field> value <v> returned 0 records — verify with listPicklistValues"
 * warning when the result set is empty.
 *
 * String labels are untouched — they flow through label resolution and the
 * S1 picklist blocker exactly as before. Only `eq` filters are checked
 * (convenience ops build `eq` for status/priority).
 */
export interface SpecialOpPicklistIdCheck {
    blocker: FlatErrorResponse | null;
    warnings: string[];
    unvalidatedNumericFilters: Array<{ field: string; value: number }>;
}

interface PicklistIdEntry {
    id: string;
    label: string;
}

/**
 * B2 (v2.28.9): keys include the credential identity (`<identity>|<resource>.<field>`),
 * matching the per-credential keying of every other cache in this repo —
 * picklist ID sets are per-tenant data and must never be shared across credentials.
 */
const picklistIdSetCache = new Map<string, { entries: PicklistIdEntry[]; fetchedAt: number }>();
const PICKLIST_ID_SET_TTL_MS = 5 * 60 * 1000;
const PICKLIST_ID_SET_CACHE_MAX = 100;
const PICKLIST_ID_SET_MAX_PAGES = 5; // 5 × 500 = 2500 entries — far beyond any status/priority list

async function getPicklistIdEntries(
    context: IExecuteFunctions,
    resource: string,
    field: FieldMeta,
): Promise<PicklistIdEntry[] | null> {
    const inline = (field.allowedValues ?? [])
        .map((v) => ({ id: String(v.id), label: String(v.label) }))
        .filter((v) => v.id !== '');
    if (inline.length > 0) return inline;

    // B2 (v2.28.9): key the cache per credential identity — the same
    // derivation (resolveCredentialIdentity) that metadataCache/artifactCache
    // use. Picklist ID sets are per-tenant data: sharing a `resource.field`
    // key across credentials let tenant B's numeric value validate against
    // tenant A's cached set (spurious INVALID_PICKLIST_VALUE, or a silent
    // zero when A's set happens to contain B's invalid value). A null
    // identity (credentials unreadable) bypasses the cache entirely — the
    // listPicklistValues call below would also fail in that state, so
    // nothing is ever stored.
    const credentialIdentity = await resolveCredentialIdentity(context);
    const key = credentialIdentity !== null ? `${credentialIdentity}|${resource}.${field.id}` : null;
    if (key !== null) {
        const cached = picklistIdSetCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < PICKLIST_ID_SET_TTL_MS) return cached.entries;
    }

    try {
        const entries: PicklistIdEntry[] = [];
        let page = 1;
        let more = true;
        while (more && page <= PICKLIST_ID_SET_MAX_PAGES) {
            const result = await listPicklistValues(context, resource, field.id, undefined, 500, page);
            for (const value of result.values) {
                if (value.id === undefined || value.id === null) continue;
                entries.push({ id: String(value.id), label: String(value.label) });
            }
            more = result.hasMore === true;
            page += 1;
        }
        if (entries.length === 0) return null; // payload carried no ids → fallback branch
        if (key !== null) {
            if (picklistIdSetCache.size >= PICKLIST_ID_SET_CACHE_MAX) {
                const firstKey = picklistIdSetCache.keys().next().value;
                if (firstKey !== undefined) picklistIdSetCache.delete(firstKey);
            }
            picklistIdSetCache.set(key, { entries, fetchedAt: Date.now() });
        }
        return entries;
    } catch {
        return null; // metadata/infrastructure failure → fallback branch (never block a read on this)
    }
}

export async function validateSpecialOpPicklistIds(
    context: IExecuteFunctions,
    resource: string,
    operation: string,
    filters: ToolFilter[],
    readFields: FieldMeta[],
): Promise<SpecialOpPicklistIdCheck> {
    const warnings: string[] = [];
    const unvalidatedNumericFilters: Array<{ field: string; value: number }> = [];
    const invalidDetails: Array<{ field: string; value: number; availableValues: string }> = [];

    const integerLikeTypes = new Set(['integer', 'number', 'long', 'decimal', 'double']);

    await Promise.all(
        filters.map(async (filter) => {
            if (filter.op !== 'eq') return;
            if (filter.value === undefined || filter.value === null) return;

            // Only ID-like values need the ID-set check — labels go through
            // resolveAndClassifyFilters / buildPicklistFilterBlocker as before.
            let numericValue: number | null = null;
            if (typeof filter.value === 'number') {
                if (Number.isInteger(filter.value) && filter.value >= 0) numericValue = filter.value;
            } else if (typeof filter.value === 'string') {
                const trimmed = filter.value.trim();
                if (/^\d+$/.test(trimmed)) {
                    const parsed = parseInt(trimmed, 10);
                    if (String(parsed) === trimmed) numericValue = parsed;
                }
            }
            if (numericValue === null) return;

            const field = readFields.find((f) => f.id.toLowerCase() === filter.field.toLowerCase());
            if (!field) return;
            // Mirror the resolver's picklist-shaped predicate (S1): Autotask
            // sometimes reports status/priority with isPickList:false on an
            // integer-typed field.
            const isIntegerFieldWithPicklistSemantics =
                !field.isPickList &&
                !field.isReference &&
                integerLikeTypes.has((field.type ?? '').toLowerCase());
            if (!field.isPickList && !isIntegerFieldWithPicklistSemantics) return;

            const entries = await getPicklistIdEntries(context, resource, field);
            if (entries === null) {
                unvalidatedNumericFilters.push({ field: field.id, value: numericValue });
                return;
            }
            const validIds = new Set(entries.map((entry) => entry.id));
            if (!validIds.has(String(numericValue))) {
                const preview = entries.slice(0, 40).map((entry) => `${entry.id}=${entry.label}`).join('; ');
                invalidDetails.push({
                    field: field.id,
                    value: numericValue,
                    availableValues: entries.length > 40 ? `${preview} (and ${entries.length - 40} more)` : preview,
                });
            }
        }),
    );

    if (invalidDetails.length === 0) {
        return { blocker: null, warnings, unvalidatedNumericFilters };
    }

    const fields = Array.from(new Set(invalidDetails.map((d) => d.field)));
    const fieldIdClause = fields.map((f) => `fieldId='${f}'`).join("' or ");
    const blocker = wrapError(
        resource,
        operation,
        ERROR_TYPES.INVALID_PICKLIST_VALUE,
        `Numeric value(s) not a valid ${resource} picklist ID: ${invalidDetails
            .map((d) => `${d.field}=${d.value} (available: ${d.availableValues})`)
            .join('; ')}.`,
        `Call autotask_${resource} with operation 'listPicklistValues' (${fieldIdClause}) to see valid IDs and labels, then retry operation '${operation}' with one of them or a label.`,
        {
            invalidPicklistValues: invalidDetails.map((d) => ({ field: d.field, value: d.value })),
        },
        ['listPicklistValues'],
    );
    return { blocker, warnings, unvalidatedNumericFilters };
}

export async function resolveCompanyToProjectIdFilter(
	context: IExecuteFunctions,
	companyRaw: string | number,
	operationName: string,
	callerResource: string,
): Promise<
	| { filter: ToolFilter; warning?: string }
	| { empty: true }
	| { error: FlatErrorResponse }
> {
	let companyId: number;
	const raw = String(companyRaw).trim();
	if (/^\d+$/.test(raw)) {
		companyId = Number(raw);
	} else {
		const companyLookup = await autotaskApiRequest.call(
			context, 'POST', 'Companies/query',
			{
				filter: [{ field: 'companyName', op: 'eq', value: raw }],
				MaxRecords: 1,
			} as IDataObject,
		) as { items?: IAutotaskEntity[] };
		const matches = Array.isArray(companyLookup.items) ? companyLookup.items : [];
		if (matches.length === 0) {
			// Try partial match to provide suggestions
			try {
				const partialLookup = await autotaskApiRequest.call(
					context, 'POST', 'Companies/query',
					{
						filter: [{ field: 'companyName', op: 'contains', value: raw }],
						MaxRecords: 5,
						IncludeFields: ['id', 'companyName'],
					} as IDataObject,
				) as { items?: IAutotaskEntity[] };
				const partialMatches = Array.isArray(partialLookup.items) ? partialLookup.items : [];
				const candidates = partialMatches.map((c) => ({
					id: c.id as string | number,
					displayName: (c.companyName ?? c.id) as string,
				}));
				return {
					error: wrapError(
						callerResource,
						operationName,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`Company '${raw}' not found.`,
						candidates.length > 0
							? `Did you mean: ${candidates.map((c) => `'${c.displayName}'`).join(', ')}? Use the exact name or a numeric companyID.`
							: 'Verify the company name is exact, or use a numeric companyID.',
					),
				};
			} catch {
				return {
					error: wrapError(
						callerResource,
						operationName,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`Company '${raw}' not found.`,
						'Verify the company name is exact, or use a numeric companyID.',
					),
				};
			}
		}
		companyId = Number(matches[0].id);
	}

	const projectsResp = await autotaskApiRequest.call(
		context, 'POST', 'Projects/query',
		{
			filter: [{ field: 'companyID', op: 'eq', value: companyId }],
			MaxRecords: 500,
			IncludeFields: ['id'],
		} as IDataObject,
	) as { items?: IAutotaskEntity[] };
	const projectIds = (Array.isArray(projectsResp.items) ? projectsResp.items : [])
		.map((p) => Number(p.id))
		.filter((n) => Number.isFinite(n));

	if (projectIds.length === 0) {
		return { empty: true };
	}

	return {
		filter: { field: 'projectID', op: 'in', value: projectIds } as ToolFilter,
		warning: projectIds.length >= 500
			? `Company expanded to 500+ projects — task results may be incomplete. Narrow the search by date or status.`
			: undefined,
	};
}
