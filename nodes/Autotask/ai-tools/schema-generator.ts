import { z } from 'zod';
import type { FieldMeta } from '../helpers/aiHelper';
import { FilterOperators } from '../constants/filters';

const FILTER_OP_ENUM = z.enum([
    'eq', 'noteq', 'gt', 'gte', 'lt', 'lte',
    'contains', 'beginsWith', 'endsWith',
    'exist', 'notExist', 'in', 'notIn',
]);
const DOMAIN_SEARCH_OP_ENUM = z.enum(['eq', 'beginsWith', 'endsWith', 'contains', 'like']);
const MASKED_UDF_POLICY_ENUM = z.enum(['omit', 'fail']);
const ATTACHMENT_OVERSIZE_POLICY_ENUM = z.enum(['skip+note', 'fail']);
const PARTIAL_FAILURE_STRATEGY_ENUM = z.enum(['deactivateDestination', 'leaveActiveWithNote']);
const DUE_WINDOW_PRESET_ENUM = z.enum([
    'today',
    'tomorrow',
    'plus2Days',
    'plus3Days',
    'plus4Days',
    'plus5Days',
    'plus7Days',
    'plus14Days',
    'plus30Days',
    'custom',
]);
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

/** Custom recency: last_Nd where N is 1–365 (e.g. last_5d, last_45d) for a custom number of days. */
const RECENCY_CUSTOM_DAYS = z.string().regex(/^last_\d+d$/).refine(
    (s) => {
        const n = parseInt(s.replace(/^last_(\d+)d$/, '$1'), 10);
        return Number.isFinite(n) && n >= 1 && n <= 365;
    },
    { message: 'Custom recency must be last_Nd with N between 1 and 365 (e.g. last_5d, last_45d).' },
);

const RECENCY_SCHEMA = z
    .union([RECENCY_ENUM, RECENCY_CUSTOM_DAYS])
    .optional()
    .describe(
        "Preset time window (e.g. last_7d, last_30d) or custom days as last_Nd with N from 1 to 365 (e.g. last_5d, last_45d). Use EITHER recency OR since/until, not both. When since or until is set, recency is ignored. Use recency for simple 'last N days' style queries; use since/until only when you need an explicit UTC range. Tool description includes current UTC reference for 'now'.",
    );

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
        recency: RECENCY_SCHEMA,
        since: z
            .string()
            .optional()
            .describe(
                'Custom range start in ISO-8601 UTC format (e.g. 2026-01-01T00:00:00Z). When set, recency is ignored (since/until take precedence). Use with until for an explicit range; prefer recency for preset windows. Use current UTC from tool description as reference.',
            ),
        until: z
            .string()
            .optional()
            .describe(
                'Custom range end in ISO-8601 UTC format (e.g. 2026-01-31T23:59:59Z). Requires either since or recency. When since is set, recency is ignored. Use current UTC from tool description as reference.',
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

export function getTicketSlaHealthCheckSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Ticket ID to check. Provide this or ticketNumber.'),
        ticketNumber: z
            .string()
            .optional()
            .describe('Ticket number to check (for example T20240615.0674). Provide this or ticket id.'),
        ticketFields: z
            .string()
            .optional()
            .describe(
                'Optional comma-separated ticket fields to return in the ticket section, for example id,ticketNumber,title,status,companyID.',
            ),
    });
}

export function getConfigurationItemMoveConfigurationItemSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        sourceConfigurationItemId: z
            .number()
            .int()
            .positive()
            .describe('Source configuration item ID to clone.'),
        destinationCompanyId: z
            .number()
            .int()
            .positive()
            .describe('Destination company ID for the new configuration item.'),
        destinationCompanyLocationId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional destination company location ID. Omit to clear destination location.'),
        destinationContactId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional destination contact ID. Omit to clear contact linkage.'),
        copyUdfs: z.boolean().optional().describe('Whether to copy user-defined fields (default true).'),
        copyAttachments: z.boolean().optional().describe('Whether to copy configuration item attachments (default true).'),
        copyNotes: z.boolean().optional().describe('Whether to copy notes (default true).'),
        copyNoteAttachments: z.boolean().optional().describe('Whether to copy note attachments (default true).'),
        deactivateSource: z.boolean().optional().describe('Whether to deactivate the source CI after safety checks (default true).'),
        dryRun: z.boolean().optional().describe('When true, return a migration plan without mutations (default false).'),
        idempotencyKey: z.string().optional().describe('Optional run key for traceability and workflow-managed idempotency.'),
        impersonationResourceId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional resource ID to impersonate. Created records (CI, notes, attachments) will be attributed to this resource. Omit to use the credential user.'),
        proceedWithoutImpersonationIfDenied: z
            .boolean()
            .optional()
            .describe('Only applies when impersonationResourceId is set. When true, if an impersonated write is denied due to permissions, retry once without impersonation and proceed as the API user (default true).'),
        includeMaskedUdfsPolicy: MASKED_UDF_POLICY_ENUM
            .optional()
            .describe("How to handle masked UDFs: 'omit' (default) or 'fail'."),
        attachmentOversizePolicy: ATTACHMENT_OVERSIZE_POLICY_ENUM
            .optional()
            .describe("How to handle oversize attachments: 'skip+note' (default) or 'fail'."),
        partialFailureStrategy: PARTIAL_FAILURE_STRATEGY_ENUM
            .optional()
            .describe("How to handle partial failure after destination create: 'deactivateDestination' (default) or 'leaveActiveWithNote'."),
        retryMaxRetries: z.number().int().min(0).max(10).optional().describe('Retry max attempts for transient copy errors (default 3).'),
        retryBaseDelayMs: z.number().int().min(50).max(60000).optional().describe('Retry base delay in milliseconds (default 500).'),
        retryJitter: z.boolean().optional().describe('Whether to use jitter in retry backoff (default true).'),
        throttleMaxBytesPer5Min: z.number().int().min(1).optional().describe('Rolling upload throughput limit in bytes per 5 minutes (default 10000000).'),
        throttleMaxSingleFileBytes: z.number().int().min(1).optional().describe('Maximum attachment size per file in bytes (default 6291456).'),
    });
}

export function getContactMoveToCompanySchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        sourceContactId: z
            .number()
            .int()
            .positive()
            .describe('Source contact ID to move.'),
        destinationCompanyId: z
            .number()
            .int()
            .positive()
            .describe('Destination company ID for the cloned contact.'),
        dryRun: z
            .boolean()
            .optional()
            .describe('When true, returns a migration plan without executing any writes (default false).'),
        destinationCompanyLocationId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional destination company location ID. Omit or null for auto-mapping behaviour.'),
        skipIfDuplicateEmailFound: z
            .boolean()
            .optional()
            .describe('Whether to skip move when duplicate email exists on destination company (default true).'),
        copyContactGroups: z
            .boolean()
            .optional()
            .describe('Whether to copy contact group memberships (default true).'),
        copyCompanyNotes: z
            .boolean()
            .optional()
            .describe('Whether to copy company notes linked to the contact (default true).'),
        copyNoteAttachments: z
            .boolean()
            .optional()
            .describe('Whether to copy attachments for copied notes (default true).'),
        sourceAuditNote: z
            .string()
            .optional()
            .describe('Optional audit note template written to the source company context.'),
        destinationAuditNote: z
            .string()
            .optional()
            .describe('Optional audit note template written to the destination company context.'),
        impersonationResourceId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional resource ID to impersonate for write calls.'),
        proceedWithoutImpersonationIfDenied: z
            .boolean()
            .optional()
            .describe('When true and impersonation is provided, retry once without impersonation if denied (default true).'),
    });
}

export function getTransferOwnershipSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
    return z.object({
        sourceResourceId: z
            .number()
            .int()
            .positive()
            .describe('Source resource ID currently assigned to work. Source can be inactive.'),
        destinationResourceId: z
            .number()
            .int()
            .positive()
            .describe('Receiving resource ID to assign work to. Receiving resource must be active.'),
        dryRun: z
            .boolean()
            .optional()
            .describe('When true, returns a plan without writing updates (default false).'),
        includeTickets: z.boolean().optional().describe('Whether to include tickets (default false).'),
        includeProjects: z.boolean().optional().describe('Whether to include projects (default false). When true, use projectReassignMode to control lead, tasks, and task secondary resources.'),
        includeServiceCallAssignments: z.boolean().optional().describe('Whether to reassign service call task/ticket resources (default false).'),
        includeAppointments: z.boolean().optional().describe('Whether to reassign appointments (default false).'),
        includeCompanies: z.boolean().optional().describe('Whether to transfer companies owned by the source resource (default false).'),
        companyIdAllowlist: z
            .string()
            .optional()
            .describe('Optional comma-separated company IDs to scope company transfer.'),
        includeOpportunities: z.boolean().optional().describe('Whether to transfer opportunities owned by the source resource (default false).'),
        dueWindowPreset: DUE_WINDOW_PRESET_ENUM
            .optional()
            .describe("Optional due window preset. Use 'custom' with dueBeforeCustom."),
        dueBeforeCustom: z
            .string()
            .optional()
            .describe('Required when dueWindowPreset is custom. Accepts YYYY-MM-DD or ISO-8601 datetime.'),
        onlyOpenActive: z.boolean().optional().describe('When true, excludes terminal statuses by default (default true).'),
        includeItemsWithNoDueDate: z.boolean().optional().describe('Whether items with no due/end date are included (default true, unless due window is set).'),
        ticketAssignmentMode: z
            .enum(['primaryOnly', 'primaryAndSecondary'])
            .optional()
            .describe('Ticket assignment scope (default primaryOnly).'),
        projectReassignMode: z
            .enum(['leadOnly', 'leadAndTasks', 'leadTasksAndSecondary', 'tasksOnly', 'tasksAndSecondary'])
            .optional()
            .describe('Project reassignment scope (default leadAndTasks). Lead = project lead. Tasks = tasks under projects. Secondary = task secondary resources under project tasks.'),
        maxItemsPerEntity: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .optional()
            .describe('Hard safety cap per entity type (default 500).'),
        maxCompanies: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .optional()
            .describe('Hard safety cap for companies (default 500).'),
        statusAllowlistByLabel: z
            .string()
            .optional()
            .describe('Optional comma-separated status labels to include.'),
        statusAllowlistByValue: z
            .string()
            .optional()
            .describe('Optional comma-separated status integer values to include.'),
        addAuditNotes: z.boolean().optional().describe('Whether to create per-entity audit notes (default false).'),
        auditNoteTemplate: z
            .string()
            .optional()
            .describe('Audit note template with placeholders: {sourceResourceName}, {sourceResourceId}, {destinationResourceName}, {destinationResourceId}, {date}, {entityType}, {entityId}.'),
        impersonationResourceId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Optional resource ID to impersonate for write calls.'),
        proceedWithoutImpersonationIfDenied: z
            .boolean()
            .optional()
            .describe('When true and impersonation is provided, retry once without impersonation if denied (default true).'),
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
export function getCreateSchema(
	fields: FieldMeta[],
	supportsImpersonation = false,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
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

	if (supportsImpersonation) {
		shape.impersonationResourceId = z
			.number()
			.int()
			.positive()
			.optional()
			.describe(
				'Optional resource ID to impersonate for write attribution. Omit to write as the API credential user.',
			);
		shape.proceedWithoutImpersonationIfDenied = z
			.boolean()
			.optional()
			.describe(
				'Only applies when impersonationResourceId is set. When true, denied impersonated writes retry once without impersonation. Default true.',
			);
	}

    return z.object(shape);
}

/**
 * Build update schema from field metadata.
 * id is required; all other fields optional. No additionalFields JSON.
 */
export function getUpdateSchema(
	fields: FieldMeta[],
	supportsImpersonation = false,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
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

	if (supportsImpersonation) {
		shape.impersonationResourceId = z
			.number()
			.int()
			.positive()
			.optional()
			.describe(
				'Optional resource ID to impersonate for write attribution. Omit to write as the API credential user.',
			);
		shape.proceedWithoutImpersonationIfDenied = z
			.boolean()
			.optional()
			.describe(
				'Only applies when impersonationResourceId is set. When true, denied impersonated writes retry once without impersonation. Default true.',
			);
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
    if (!valid.includes(lower)) {
        throw new Error(`Unsupported filter operator: '${op}'. Valid operators are: ${valid.join(', ')}`);
    }
    return (FilterOperators as Record<string, string>)[lower];
}
