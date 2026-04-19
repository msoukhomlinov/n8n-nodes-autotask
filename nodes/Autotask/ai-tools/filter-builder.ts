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

export interface ToolFilter {
    field: string;
    op: string;
    value?: string | number | boolean | Array<string | number | boolean>;
    udf?: boolean;
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
): ToolFilter[] {
    const filters: ToolFilter[] = [];
    const readFieldLookup = buildFieldLookup(readFields);

    const mappedOp1 = params.filter_op ? mapFilterOp(params.filter_op) : 'eq';
    const isNullCheckOp1 = mappedOp1 === 'exist' || mappedOp1 === 'notExist';
    if (
        params.filter_field &&
        (isNullCheckOp1 || (params.filter_value !== undefined && params.filter_value !== ''))
    ) {
        const canonicalField = readFieldLookup.get(params.filter_field.toLowerCase());
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
            field: canonicalField?.id ?? params.filter_field,
            op: mappedOp1,
            ...(!isNullCheckOp1 ? { value: coercedValue1 } : {}),
            ...(canonicalField?.udf ? { udf: true } : {}),
        });
    }

    const mappedOp2 = params.filter_op_2 ? mapFilterOp(params.filter_op_2) : 'eq';
    const isNullCheckOp2 = mappedOp2 === 'exist' || mappedOp2 === 'notExist';
    if (
        params.filter_field_2 &&
        (isNullCheckOp2 || (params.filter_value_2 !== undefined && params.filter_value_2 !== ''))
    ) {
        const canonicalField = readFieldLookup.get(params.filter_field_2.toLowerCase());
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
            field: canonicalField?.id ?? params.filter_field_2,
            op: mappedOp2,
            ...(!isNullCheckOp2 ? { value: coercedValue2 } : {}),
            ...(canonicalField?.udf ? { udf: true } : {}),
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

    return {
        filters,
        resolutions: allResolutions,
        warnings: allWarnings,
        pendingConfirmations: allPendingConfirmations,
        unresolvedIdLikeFilters,
        unresolvedIdLikeFilterDetails,
    };
}
