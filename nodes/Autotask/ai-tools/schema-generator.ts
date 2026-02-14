import { z } from 'zod';
import type { FieldMeta } from '../helpers/aiHelper';
import { FilterOperators } from '../constants/filters';

const FILTER_OP_ENUM = z.enum([
    'eq', 'noteq', 'gt', 'gte', 'lt', 'lte',
    'contains', 'beginsWith', 'endsWith',
    'exist', 'notExist', 'in', 'notIn',
]);
const DOMAIN_SEARCH_OP_ENUM = z.enum(['eq', 'beginsWith', 'endsWith', 'contains', 'like']);
const RECENCY_ENUM = z.enum([
    'last_15m',
    'last_1h',
    'last_4h',
    'last_12h',
    'last_24h',
    'last_3d',
    'last_7d',
    'last_14d',
    'last_30d',
    'last_90d',
]);

const FILTER_VALUE_SCHEMA = z
    .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .describe('Filter value. Use number for numeric fields, true/false for booleans, and arrays (or comma-separated values) for in/notIn.');

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
            .describe(
                "Comma-separated field names to return. Omit for all fields. Only use verified field names; call autotask_<resource>_describeFields with mode 'read' if unsure.",
            ),
    });
}

export function getWhoAmISchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        fields: z
            .string()
            .optional()
            .describe(
                "Comma-separated field names to return. Omit for all fields. Only use verified field names; call autotask_<resource>_describeFields with mode 'read' if unsure.",
            ),
    });
}

export function getGetManySchema(readFields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const fieldNames = getQueryableFieldNames(readFields);

    const filterFieldSchema = fieldNames
        ? z.enum(fieldNames).optional().describe('Field to filter on')
        : z
            .string()
            .optional()
            .describe("Field name to filter on. If unsure, call autotask_<resource>_describeFields with mode 'read' first.");

    const filterField2Schema = fieldNames
        ? z.enum(fieldNames).optional().describe('Second field to filter on (optional, for compound queries)')
        : z
            .string()
            .optional()
            .describe("Second field to filter on (optional). If unsure, call autotask_<resource>_describeFields with mode 'read'.");

    return z.object({
        filter_field: filterFieldSchema,
        filter_op: FILTER_OP_ENUM.optional().describe('Filter operator (default: eq)'),
        filter_value: FILTER_VALUE_SCHEMA.optional(),
        filter_field_2: filterField2Schema,
        filter_op_2: FILTER_OP_ENUM.optional().describe('Second filter operator'),
        filter_value_2: FILTER_VALUE_SCHEMA.optional().describe('Second filter value'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Max results to return (1-100, default 10)'),
        fields: z
            .string()
            .optional()
            .describe(
                "Comma-separated field names to return. Omit for all fields. Only use verified field names; call autotask_<resource>_describeFields with mode 'read' if unsure.",
            ),
        recency: RECENCY_ENUM
            .optional()
            .describe(
                "Time window shortcut for recent records. Auto-adds a date filter and returns newest first. Use for latest-style queries.",
            ),
        since: z
            .string()
            .optional()
            .describe(
                'Custom range start in ISO-8601 UTC format (for example 2026-01-01T00:00:00Z). Overrides recency when both are set.',
            ),
        until: z
            .string()
            .optional()
            .describe(
                'Custom range end in ISO-8601 UTC format (for example 2026-01-31T23:59:59Z).',
            ),
    });
}

export function getCountSchema(readFields: FieldMeta[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const fieldNames = getQueryableFieldNames(readFields);

    const filterFieldSchema = fieldNames
        ? z.enum(fieldNames).optional().describe('Field to filter on')
        : z
            .string()
            .optional()
            .describe("Field name to filter on. If unsure, call autotask_<resource>_describeFields with mode 'read' first.");

    const filterField2Schema = fieldNames
        ? z.enum(fieldNames).optional().describe('Second field to filter on (optional)')
        : z
            .string()
            .optional()
            .describe("Second field to filter on (optional). If unsure, call autotask_<resource>_describeFields with mode 'read'.");

    return z.object({
        filter_field: filterFieldSchema,
        filter_op: FILTER_OP_ENUM.optional().describe('Filter operator (default: eq)'),
        filter_value: FILTER_VALUE_SCHEMA.optional(),
        filter_field_2: filterField2Schema,
        filter_op_2: FILTER_OP_ENUM.optional().describe('Second filter operator'),
        filter_value_2: FILTER_VALUE_SCHEMA.optional().describe('Second filter value'),
    });
}

export function getCompanySearchByDomainSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        domain: z
            .string()
            .min(1)
            .describe('Domain to search, for example autotask.net or https://www.autotask.net/'),
        domainOperator: DOMAIN_SEARCH_OP_ENUM
            .optional()
            .describe("Domain comparison operator. Use 'contains' by default; 'like' is accepted as an alias for contains."),
        searchContactEmails: z
            .boolean()
            .optional()
            .describe('When true (default), if no company website matches are found, search contacts by email domain fallback.'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Maximum company matches to return (1-100, default 25).'),
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

export function getDescribeFieldsSchema(): z.ZodObject<{ mode: z.ZodOptional<z.ZodEnum<['read', 'write']>> }> {
    return z.object({
        mode: z
            .enum(['read', 'write'])
            .optional()
            .describe("Field mode to describe. Use 'read' for get/getMany/count fields and 'write' for create/update fields."),
    });
}

export function getListPicklistValuesSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        fieldId: z
            .string()
            .describe('Field ID to list picklist values for. Use describeFields first to confirm the field ID.'),
        query: z.string().optional().describe('Optional search term to filter picklist values.'),
        limit: z.number().optional().describe('Maximum values to return (default 50).'),
        page: z.number().optional().describe('Page number for pagination (default 1).'),
    });
}

/**
 * JSON Schema for describeFields helper tool. Explicit type: "object" is required
 * so n8n/API validation (tools.N.custom.input_schema.type) does not fail.
 */
export function getDescribeFieldsJsonSchema(): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['read', 'write'],
                description:
                    "Field mode to describe. Use 'read' for get/getMany/count fields and 'write' for create/update fields.",
            },
        },
        additionalProperties: false,
    };
}

/**
 * JSON Schema for listPicklistValues helper tool. Explicit type: "object" is required
 * so n8n/API validation (tools.N.custom.input_schema.type) does not fail.
 */
export function getListPicklistValuesJsonSchema(): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            fieldId: {
                type: 'string',
                description:
                    'Field ID to list picklist values for. Use describeFields first to confirm the field ID.',
            },
            query: {
                type: 'string',
                description: 'Optional search term to filter picklist values.',
            },
            limit: {
                type: 'number',
                description: 'Maximum values to return (default 50).',
            },
            page: {
                type: 'number',
                description: 'Page number for pagination (default 1).',
            },
        },
        required: ['fieldId'],
        additionalProperties: false,
    };
}

/**
 * Map schema filter_op string to Autotask FilterOperators.
 */
export function mapFilterOp(op: string): string {
    const lower = op?.toLowerCase();
    if (lower === 'like') {
        return FilterOperators.contains;
    }
    const valid = Object.keys(FilterOperators) as string[];
    return valid.includes(lower) ? (FilterOperators as Record<string, string>)[lower] : FilterOperators.eq;
}
