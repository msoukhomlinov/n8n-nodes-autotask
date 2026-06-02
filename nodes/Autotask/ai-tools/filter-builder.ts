import moment from 'moment-timezone';
import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { mapFilterOp } from './schema-generator';
import { getReferencedEntity, type FieldMeta } from '../helpers/aiHelper';
import {
    resolveFilterLabelsToIds,
    type LabelResolution,
    type PendingLabelConfirmation,
} from '../helpers/label-resolution';
import { isLikelyId } from '../helpers/id-utils';
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
    if (
        params.filter_field &&
        (isNullCheckOp1 || (params.filter_value !== undefined && params.filter_value !== ''))
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
    if (
        params.filter_field_2 &&
        (isNullCheckOp2 || (params.filter_value_2 !== undefined && params.filter_value_2 !== ''))
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
    const unresolvedPicklistFilters = filters.filter((filter) => {
        const field = readFields.find((f) => f.id.toLowerCase() === filter.field.toLowerCase());
        if (!field?.isPickList) return false;
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
