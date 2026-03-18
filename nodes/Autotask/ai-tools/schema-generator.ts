import type { FieldMeta } from '../helpers/aiHelper';
import { FilterOperators } from '../constants/filters';
import type { RuntimeZod } from './runtime';

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
        parts.push(`(references ${field.referencesEntity} — accepts ID or name)`);
    }
    return parts.join(' ');
}

/**
 * Map schema filter_op string to Autotask FilterOperators.
 */
export function mapFilterOp(op: string): string {
    const lower = op?.toLowerCase();
    if (lower === 'like') {
        return FilterOperators.contains;
    }
    // 'and'/'or' are grouping operators, not field-level comparison operators
    if (lower === 'and' || lower === 'or') {
        throw new Error(`'${op}' is a grouping operator and cannot be used as a filter_op. Use filter_logic='or' for OR queries between filter pairs.`);
    }
    const validKeys = (Object.keys(FilterOperators) as string[]).filter(k => k !== 'and' && k !== 'or');
    const matchedKey = validKeys.find(k => k.toLowerCase() === lower);
    if (!matchedKey) {
        throw new Error(`Unsupported filter operator: '${op}'. Valid operators are: ${validKeys.join(', ')}`);
    }
    return (FilterOperators as Record<string, string>)[matchedKey];
}

export function getRuntimeSchemaBuilders(rz: RuntimeZod) {
    // Enum constants using runtime zod (ensures instanceof checks pass in all n8n versions)
    const rFilterOpEnum = rz.enum([
        'eq', 'noteq', 'gt', 'gte', 'lt', 'lte',
        'contains', 'beginsWith', 'endsWith',
        'exist', 'notExist', 'in', 'notIn',
    ]);
    const rFilterValueSchema = rz.union([
        rz.string(),
        rz.number(),
        rz.boolean(),
        rz.array(rz.union([rz.string(), rz.number(), rz.boolean()])),
    ]).describe('Filter value. Use number for numeric fields, true/false for booleans, and arrays or comma-separated values for in/notIn.');
    const rRecencyEnum = rz.enum([
        'last_15m', 'last_1h', 'last_4h', 'last_12h', 'last_24h',
        'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d',
    ]);
    const rRecencyCustomDays = rz.string().regex(/^last_\d+d$/).refine(
        (s) => {
            const n = parseInt(s.replace(/^last_(\d+)d$/, '$1'), 10);
            return Number.isFinite(n) && n >= 1 && n <= 365;
        },
        { message: 'Custom recency must be last_Nd with N between 1 and 365 (e.g. last_5d, last_45d).' },
    );
    const rRecencySchema = rz.union([rRecencyEnum, rRecencyCustomDays]).optional()
        .describe("Preset time window (e.g. last_7d, last_30d) or custom days as last_Nd with N from 1 to 365 (e.g. last_5d, last_45d). Use EITHER recency OR since/until.");

    function buildUnifiedSchema(
        resource: string,
        operations: string[],
        readFields: FieldMeta[],
        writeFields: FieldMeta[],
    ) {
        const allOps = [...new Set([...operations, 'describeFields', 'listPicklistValues'])] as [string, ...string[]];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape: Record<string, any> = {};

        // operation — required enum
        shape.operation = rz.enum(allOps).describe(
            `Operation to perform. One of: ${allOps.join(', ')}`,
        );

        const hasGetFamily = operations.some(op =>
            ['get', 'whoAmI', 'getMany', 'count', 'getPosted', 'getUnposted', 'searchByDomain'].includes(op)
        );
        const hasListFamily = operations.some(op =>
            ['getMany', 'count', 'getPosted', 'getUnposted'].includes(op)
        );
        const hasGetOrDelete = operations.some(op => ['get', 'delete'].includes(op));
        const hasUpdate = operations.includes('update');
        const hasCreate = operations.includes('create');
        const hasSlaHealthCheck = operations.includes('slaHealthCheck');
        const hasSearchByDomain = operations.includes('searchByDomain');
        const hasMoveConfigItem = operations.includes('moveConfigurationItem');
        const hasMoveToCompany = operations.includes('moveToCompany');
        const hasTransferOwnership = operations.includes('transferOwnership');

        // id — used by get, delete, update, slaHealthCheck
        if (hasGetOrDelete || hasUpdate || hasSlaHealthCheck) {
            shape.id = rz.number().optional().describe('Entity ID. Required for get, delete, update operations.');
        }

        // fields — column selection
        if (hasGetFamily || hasCreate) {
            shape.fields = rz.string().optional().describe(
                `Comma-separated field names to return. Omit for all fields. Call autotask_${resource} with operation 'describeFields' if unsure.`,
            );
        }

        // Filter fields for list operations
        if (hasListFamily) {
            const fieldNames = readFields.filter(f => !f.udf).map(f => f.id);
            const filterFieldDesc = "Field to filter on. Use operation 'describeFields' to see valid field names.";
            shape.filter_field = fieldNames.length > 0
                ? rz.enum(fieldNames as [string, ...string[]]).optional().describe('Field to filter on')
                : rz.string().optional().describe(filterFieldDesc);
            shape.filter_op = rFilterOpEnum.optional().describe('Filter operator (default: eq)');
            shape.filter_value = rFilterValueSchema.optional();
            shape.filter_field_2 = fieldNames.length > 0
                ? rz.enum(fieldNames as [string, ...string[]]).optional().describe('Second field to filter on (optional)')
                : rz.string().optional().describe('Second field to filter on (optional)');
            shape.filter_op_2 = rFilterOpEnum.optional().describe('Second filter operator');
            shape.filter_value_2 = rFilterValueSchema.optional().describe('Second filter value');
            shape.filter_logic = rz.enum(['and', 'or']).optional().describe(
                "Logic between filter pairs. Default 'and' (both must match). Use 'or' for either-match queries (e.g. status='Open' OR status='In Progress').",
            );
            shape.limit = rz.number().int().min(1).max(100).optional().describe('Max results (1-100, default 10)');
            shape.offset = rz.number().int().min(0).optional().describe('Skip first N records (for pagination, max 99). Use with limit. Response includes hasMore and nextOffset. Limited to first 100 total records — use narrower filters for larger datasets.');
            shape.recency = rRecencySchema;
            shape.since = rz.string().optional().describe('Range start in ISO-8601 UTC format (e.g. 2026-01-01T00:00:00Z). When set, recency is ignored.');
            shape.until = rz.string().optional().describe('Range end in ISO-8601 UTC format (e.g. 2026-01-31T23:59:59Z). Requires since or recency.');
        }

        // searchByDomain fields
        if (hasSearchByDomain) {
            shape.domain = rz.string().min(1).optional().describe('Domain to search, e.g. autotask.net or https://www.autotask.net/');
            shape.domainOperator = rz.enum(['eq', 'beginsWith', 'endsWith', 'contains']).optional()
                .describe("Domain comparison operator (default 'contains').");
            shape.searchContactEmails = rz.boolean().optional()
                .describe('When true (default), fall back to contact email search if no website match.');
        }

        // slaHealthCheck fields
        if (hasSlaHealthCheck) {
            shape.ticketNumber = rz.string().optional().describe('Ticket number (e.g. T20240615.0674). Provide this or id.');
            shape.ticketFields = rz.string().optional().describe('Optional comma-separated ticket fields to return.');
        }

        // create / update fields from metadata
        if (hasCreate || hasUpdate) {
            for (const field of writeFields) {
                if (field.id === 'id') continue;
                if (shape[field.id]) continue;
                const desc = buildFieldDescription(field);
                // Picklist and reference fields accept string|number so the LLM can pass
                // human-readable labels (e.g. "Will Spence") which the executor auto-resolves to IDs.
                const needsLabelResolution = field.isPickList || field.isReference;
                const base = needsLabelResolution ? rz.union([rz.number(), rz.string()])
                    : field.type === 'number' ? rz.number()
                    : field.type === 'boolean' ? rz.boolean()
                    : rz.string();
                shape[field.id] = base.optional().describe(desc);
            }
            if (!shape.impersonationResourceId) {
                shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional()
                    .describe('Optional resource ID or name to impersonate for write attribution. Accepts a numeric ID, full name (e.g. "Bob Smith"), or email address — names and emails are auto-resolved to resource IDs.');
                shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional()
                    .describe('When true and impersonation is set, retry without impersonation if denied (default true).');
            }
        }

        // moveConfigurationItem fields
        if (hasMoveConfigItem) {
            if (!shape.sourceConfigurationItemId)
                shape.sourceConfigurationItemId = rz.number().int().positive().optional().describe('Source configuration item ID to clone.');
            if (!shape.destinationCompanyId)
                shape.destinationCompanyId = rz.number().int().positive().optional().describe('Destination company ID.');
            if (!shape.dryRun)
                shape.dryRun = rz.boolean().optional().describe('When true, return a plan without mutations (default false).');
            shape.destinationCompanyLocationId = rz.number().int().positive().optional().describe('Optional destination company location ID.');
            shape.destinationContactId = rz.number().int().positive().optional().describe('Optional destination contact ID.');
            shape.copyUdfs = rz.boolean().optional().describe('Whether to copy user-defined fields (default true).');
            shape.copyAttachments = rz.boolean().optional().describe('Whether to copy CI attachments (default true).');
            shape.copyNotes = rz.boolean().optional().describe('Whether to copy notes (default true).');
            shape.copyNoteAttachments = rz.boolean().optional().describe('Whether to copy note attachments (default true).');
            shape.deactivateSource = rz.boolean().optional().describe('Whether to deactivate the source CI after safety checks (default true).');
            shape.idempotencyKey = rz.string().optional().describe('Optional run key for traceability.');
            shape.includeMaskedUdfsPolicy = rz.enum(['omit', 'fail']).optional().describe("How to handle masked UDFs: 'omit' (default) or 'fail'.");
            shape.attachmentOversizePolicy = rz.enum(['skip+note', 'fail']).optional().describe("How to handle oversize attachments: 'skip+note' (default) or 'fail'.");
            shape.partialFailureStrategy = rz.enum(['deactivateDestination', 'leaveActiveWithNote']).optional()
                .describe("How to handle partial failure after destination create: 'deactivateDestination' (default) or 'leaveActiveWithNote'.");
            shape.retryMaxRetries = rz.number().int().min(0).max(10).optional().describe('Retry max attempts for transient errors (default 3).');
            shape.retryBaseDelayMs = rz.number().int().min(50).max(60000).optional().describe('Retry base delay in milliseconds (default 500).');
            shape.retryJitter = rz.boolean().optional().describe('Whether to use jitter in retry backoff (default true).');
            shape.throttleMaxBytesPer5Min = rz.number().int().min(1).optional().describe('Upload throughput limit in bytes per 5 minutes (default 10000000).');
            shape.throttleMaxSingleFileBytes = rz.number().int().min(1).optional().describe('Maximum attachment size per file in bytes (default 6291456).');
            if (!shape.impersonationResourceId) {
                shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional().describe('Optional resource ID or name to impersonate for write attribution. Accepts a numeric ID, full name, or email — auto-resolved.');
                shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional().describe('When true and impersonation is set, retry without impersonation if denied (default true).');
            }
        }

        // moveToCompany fields
        if (hasMoveToCompany) {
            if (!shape.sourceContactId)
                shape.sourceContactId = rz.number().int().positive().optional().describe('Source contact ID to move.');
            if (!shape.destinationCompanyId)
                shape.destinationCompanyId = rz.number().int().positive().optional().describe('Destination company ID for the cloned contact.');
            if (!shape.dryRun)
                shape.dryRun = rz.boolean().optional().describe('When true, returns a plan without mutations (default false).');
            shape.destinationCompanyLocationId = rz.number().int().positive().optional().describe('Optional destination company location ID.');
            shape.skipIfDuplicateEmailFound = rz.boolean().optional().describe('Whether to skip move when duplicate email exists on destination (default true).');
            shape.copyContactGroups = rz.boolean().optional().describe('Whether to copy contact group memberships (default true).');
            shape.copyCompanyNotes = rz.boolean().optional().describe('Whether to copy company notes linked to the contact (default true).');
            shape.copyNoteAttachments = rz.boolean().optional().describe('Whether to copy attachments for copied notes (default true).');
            shape.sourceAuditNote = rz.string().optional().describe('Optional audit note written to the source company context.');
            shape.destinationAuditNote = rz.string().optional().describe('Optional audit note written to the destination company context.');
            if (!shape.impersonationResourceId) {
                shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional().describe('Optional resource ID or name to impersonate for write attribution. Accepts a numeric ID, full name, or email — auto-resolved.');
                shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional().describe('When true and impersonation is set, retry without impersonation if denied (default true).');
            }
        }

        // transferOwnership fields
        if (hasTransferOwnership) {
            if (!shape.sourceResourceId)
                shape.sourceResourceId = rz.number().int().positive().optional().describe('Source resource ID currently assigned to work. Can be inactive.');
            if (!shape.destinationResourceId)
                shape.destinationResourceId = rz.number().int().positive().optional().describe('Receiving resource ID. Must be active.');
            if (!shape.dryRun)
                shape.dryRun = rz.boolean().optional().describe('When true, returns a plan without mutations (default false).');
            shape.includeTickets = rz.boolean().optional().describe('Whether to include tickets (default false).');
            shape.includeProjects = rz.boolean().optional().describe('Whether to include projects (default false).');
            shape.includeServiceCallAssignments = rz.boolean().optional().describe('Whether to reassign service call task/ticket resources (default false).');
            shape.includeAppointments = rz.boolean().optional().describe('Whether to reassign appointments (default false).');
            shape.includeCompanies = rz.boolean().optional().describe('Whether to transfer companies owned by the source resource (default false).');
            shape.companyIdAllowlist = rz.string().optional().describe('Optional comma-separated company IDs to scope company transfer.');
            shape.includeOpportunities = rz.boolean().optional().describe('Whether to transfer opportunities owned by the source resource (default false).');
            shape.dueWindowPreset = rz.enum(['today','tomorrow','plus2Days','plus3Days','plus4Days','plus5Days','plus7Days','plus14Days','plus30Days','custom']).optional()
                .describe("Optional due window preset. Use 'custom' with dueBeforeCustom.");
            shape.dueBeforeCustom = rz.string().optional().describe("Required when dueWindowPreset is 'custom'. Accepts YYYY-MM-DD or ISO-8601 datetime.");
            shape.onlyOpenActive = rz.boolean().optional().describe('When true, excludes terminal statuses (default true).');
            shape.includeItemsWithNoDueDate = rz.boolean().optional().describe('Whether items with no due date are included (default true, unless due window is set).');
            shape.ticketAssignmentMode = rz.enum(['primaryOnly', 'primaryAndSecondary']).optional().describe('Ticket assignment scope (default primaryOnly).');
            shape.projectReassignMode = rz.enum(['leadOnly','leadAndTasks','leadTasksAndSecondary','tasksOnly','tasksAndSecondary']).optional()
                .describe('Project reassignment scope (default leadAndTasks).');
            shape.maxItemsPerEntity = rz.number().int().min(1).max(10000).optional().describe('Safety cap per entity type (default 500).');
            shape.maxCompanies = rz.number().int().min(1).max(10000).optional().describe('Safety cap for companies (default 500).');
            shape.statusAllowlistByLabel = rz.string().optional().describe('Optional comma-separated status labels to include.');
            shape.statusAllowlistByValue = rz.string().optional().describe('Optional comma-separated status integer values to include.');
            shape.addAuditNotes = rz.boolean().optional().describe('Whether to create per-entity audit notes (default false).');
            shape.auditNoteTemplate = rz.string().optional()
                .describe('Audit note template with placeholders: {sourceResourceName}, {sourceResourceId}, {destinationResourceName}, {destinationResourceId}, {date}, {entityType}, {entityId}.');
            if (!shape.impersonationResourceId) {
                shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional().describe('Optional resource ID or name to impersonate for write attribution. Accepts a numeric ID, full name, or email — auto-resolved.');
                shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional().describe('When true and impersonation is set, retry without impersonation if denied (default true).');
            }
        }

        // createIfNotExists — reuse dynamic writeFields + add dedup/error fields
        const hasCreateIfNotExists = operations.includes('createIfNotExists');
        if (hasCreateIfNotExists) {
            // If create/update already ran, writeFields are already in shape.
            // Otherwise, populate them now using the same dynamic loop.
            if (!hasCreate && !hasUpdate) {
                for (const field of writeFields) {
                    if (field.id === 'id') continue;
                    if (shape[field.id]) continue;
                    const desc = buildFieldDescription(field);
                    const needsLabelResolution = field.isPickList || field.isReference;
                    const base = needsLabelResolution ? rz.union([rz.number(), rz.string()])
                        : field.type === 'number' ? rz.number()
                        : field.type === 'boolean' ? rz.boolean()
                        : rz.string();
                    shape[field.id] = base.optional().describe(desc);
                }
            }
            // createIfNotExists-specific fields
            if (!shape.dedupFields)
                shape.dedupFields = rz.array(rz.string()).optional()
                    .describe('Field names for duplicate detection. Use describeFields to discover available field names. Empty = skip dedup, always create.');
            if (!shape.errorOnDuplicate)
                shape.errorOnDuplicate = rz.boolean().optional()
                    .describe('When true, throw an error if a duplicate is found instead of returning a skipped outcome. Default false.');
            if (!shape.impersonationResourceId) {
                shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional()
                    .describe('Optional resource ID or name to impersonate for write attribution. Accepts a numeric ID, full name, or email — auto-resolved.');
                shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional()
                    .describe('When true and impersonation is set, retry without impersonation if denied (default true).');
            }
        }

        // describeFields fields
        shape.mode = rz.enum(['read', 'write']).optional()
            .describe("Field mode for describeFields. Use 'read' for get/getMany fields; 'write' for create/update fields.");

        // listPicklistValues fields
        shape.fieldId = rz.string().optional()
            .describe('Field ID for listPicklistValues. Required when using listPicklistValues operation.');
        shape.query = rz.string().optional()
            .describe('Optional search term to filter picklist values. Used by listPicklistValues.');
        if (!shape.limit) {
            shape.limit = rz.number().optional().describe('Max results (used by listPicklistValues for pagination, default 50).');
        }
        shape.page = rz.number().optional().describe('Page number for listPicklistValues pagination (default 1).');

        return rz.object(shape);
    }

    return { buildUnifiedSchema };
}
