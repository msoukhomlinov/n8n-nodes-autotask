import { z } from 'zod';
import type { FieldMeta } from '../helpers/aiHelper';
import { FilterOperators } from '../constants/filters';

const FILTER_OP_ENUM = z.enum([
    'eq', 'noteq', 'gt', 'gte', 'lt', 'lte',
    'contains', 'beginsWith', 'endsWith',
]);

/** Maximum number of picklist values to inline in a field description */
const MAX_INLINE_PICKLIST_VALUES = 8;

/** Picklist size threshold -- above this, tell LLM to use listPicklistValues */
const LARGE_PICKLIST_THRESHOLD = 15;

/**
 * Build a description string for a field, including picklist value hints when applicable.
 */
function buildFieldDescription(field: FieldMeta, prefix?: string): string {
    const parts: string[] = [];
    if (prefix) {
        parts.push(prefix);
    } else {
        parts.push(field.name);
    }
    if (field.required) {
        parts.push('(required)');
    }
    if (field.isPickList && field.allowedValues?.length) {
        if (field.allowedValues.length <= LARGE_PICKLIST_THRESHOLD) {
            const vals = field.allowedValues
                .slice(0, MAX_INLINE_PICKLIST_VALUES)
                .map((v) => `${v.id}=${v.label}`)
                .join(', ');
            const suffix = field.allowedValues.length > MAX_INLINE_PICKLIST_VALUES ? ', ...' : '';
            parts.push(`[values: ${vals}${suffix}]`);
        } else {
            parts.push('[large picklist -- use listPicklistValues for options]');
        }
    }
    if (field.isReference && field.referencesEntity) {
        parts.push(`(references ${field.referencesEntity})`);
    }
    return parts.join(' ');
}

/**
 * Extract queryable field names from metadata for use in filter enums.
 * Excludes UDFs to keep the enum focused on standard fields.
 */
function getQueryableFieldNames(fields: FieldMeta[]): [string, ...string[]] | null {
    const names = fields
        .filter((f) => !f.udf)
        .map((f) => f.id);
    if (names.length === 0) return null;
    return names as [string, ...string[]];
}

// ---------------------------------------------------------------------------
// Schema generators per operation
// ---------------------------------------------------------------------------

export function getGetSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        id: z.number().describe('Entity ID to retrieve'),
        fields: z
            .string()
            .optional()
            .describe('Comma-separated field names to return. Omit for all fields.'),
    });
}

export function getGetManySchema(readFields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const fieldNames = getQueryableFieldNames(readFields);

    const filterFieldSchema = fieldNames
        ? z.enum(fieldNames).optional().describe('Field to filter on')
        : z.string().optional().describe('Field name to filter on');

    const filterField2Schema = fieldNames
        ? z.enum(fieldNames).optional().describe('Second field to filter on (optional, for compound queries)')
        : z.string().optional().describe('Second field to filter on (optional)');

    return z.object({
        filter_field: filterFieldSchema,
        filter_op: FILTER_OP_ENUM.optional().describe('Filter operator (default: eq)'),
        filter_value: z.string().optional().describe('Filter value'),
        filter_field_2: filterField2Schema,
        filter_op_2: FILTER_OP_ENUM.optional().describe('Second filter operator'),
        filter_value_2: z.string().optional().describe('Second filter value'),
        limit: z.number().optional().describe('Max results to return (default 10)'),
        fields: z
            .string()
            .optional()
            .describe('Comma-separated field names to return. Omit for all fields.'),
    });
}

export function getCountSchema(readFields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const fieldNames = getQueryableFieldNames(readFields);

    const filterFieldSchema = fieldNames
        ? z.enum(fieldNames).optional().describe('Field to filter on')
        : z.string().optional().describe('Field name to filter on');

    const filterField2Schema = fieldNames
        ? z.enum(fieldNames).optional().describe('Second field to filter on (optional)')
        : z.string().optional().describe('Second field to filter on (optional)');

    return z.object({
        filter_field: filterFieldSchema,
        filter_op: FILTER_OP_ENUM.optional().describe('Filter operator (default: eq)'),
        filter_value: z.string().optional().describe('Filter value'),
        filter_field_2: filterField2Schema,
        filter_op_2: FILTER_OP_ENUM.optional().describe('Second filter operator'),
        filter_value_2: z.string().optional().describe('Second filter value'),
    });
}

export function getDeleteSchema(): z.ZodObject<{ id: z.ZodNumber }> {
    return z.object({
        id: z.number().describe('Entity ID to delete'),
    });
}

/**
 * Build create schema from field metadata.
 * All fields are included as flat typed parameters -- no additionalFields JSON.
 */
export function getCreateSchema(fields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const field of fields) {
        const desc = buildFieldDescription(field);
        const base = field.type === 'number'
            ? z.number()
            : field.type === 'boolean'
                ? z.boolean()
                : z.string();

        const withDesc = base.describe(desc);
        shape[field.id] = field.required ? withDesc : withDesc.optional();
    }

    return z.object(shape);
}

/**
 * Build update schema from field metadata.
 * id is required; all other fields optional. No additionalFields JSON.
 */
export function getUpdateSchema(fields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const shape: Record<string, z.ZodTypeAny> = {
        id: z.number().describe('Entity ID to update'),
    };

    for (const field of fields) {
        if (field.id === 'id') continue;
        const desc = buildFieldDescription(field, `New ${field.name}`);
        const base = field.type === 'number'
            ? z.number()
            : field.type === 'boolean'
                ? z.boolean()
                : z.string();
        shape[field.id] = base.optional().describe(desc);
    }

    return z.object(shape);
}

/**
 * Map schema filter_op string to Autotask FilterOperators.
 */
export function mapFilterOp(op: string): string {
    const valid = Object.keys(FilterOperators) as string[];
    const lower = op?.toLowerCase();
    return valid.includes(lower) ? (FilterOperators as Record<string, string>)[lower] : FilterOperators.eq;
}
