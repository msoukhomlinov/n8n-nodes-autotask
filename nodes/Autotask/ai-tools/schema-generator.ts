import type { FieldMeta } from '../helpers/aiHelper';
import { FilterOperators } from '../constants/filters';
import type { RuntimeZod } from './runtime';
import { IDENTIFIER_PAIR_OPERATIONS } from '../constants/resource-operations';
import { safeKeys, summariseFields, traceSchemaBuild } from './debug-trace';
import { getOperationMetadata, isWriteOperation } from './operation-metadata';
import { TYPED_REFERENCE_STRATEGIES } from '../helpers/typed-reference';
import { RESOURCES_WITH_PRIORITY, RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION } from './resource-language';

/** Picklist inlining threshold — at or below this count, inline all values; above, tell LLM to call listPicklistValues. */
const INLINE_PICKLIST_THRESHOLD = 4;

const READ_ONLY_SCHEMA_CACHE_MAX = 200;
const readOnlySchemaCache = new Map<string, unknown>();

/** Shared impersonationResourceId field description — used at all 5 schema insertion sites. */
const IMPERSONATION_RESOURCE_ID_DESCRIBE =
	'Resource ID, name, or email to impersonate for write attribution (auto-resolved).';

/** Shared proceedWithoutImpersonationIfDenied description — used at all 5 schema insertion sites. */
const IMPERSONATION_PROCEED_DESCRIBE =
	'If impersonation denied, retry without it (default true).';

function getSchemaFieldSignature(fields: FieldMeta[]): string {
	return fields
		.map((field) =>
			[
				field.id,
				field.type ?? '',
				field.required ? '1' : '0',
				field.udf ? '1' : '0',
				field.isPickList ? '1' : '0',
				field.isReference ? '1' : '0',
			].join(':'),
		)
		.sort()
		.join('|');
}

function getReadOnlySchemaCacheKey(resource: string, operations: string[], readFields: FieldMeta[]): string {
	const opSig = [...operations].sort().join(',');
	return `${resource}|${opSig}|${getSchemaFieldSignature(readFields)}`;
}

function setReadOnlySchemaCache(key: string, value: unknown): void {
	if (readOnlySchemaCache.size >= READ_ONLY_SCHEMA_CACHE_MAX) {
		const firstKey = readOnlySchemaCache.keys().next().value as string | undefined;
		if (firstKey) readOnlySchemaCache.delete(firstKey);
	}
	readOnlySchemaCache.set(key, value);
}

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
		if (field.allowedValues.length <= INLINE_PICKLIST_THRESHOLD) {
			const vals = field.allowedValues.map((v) => `${v.id}=${v.label}`).join(', ');
			parts.push(`[values: ${vals}]`);
		} else {
			parts.push(`[${field.allowedValues.length} values; use listPicklistValues]`);
		}
	}
	if (field.isReference && field.referencesEntity) {
		// Registry keys are lowercase; .toLowerCase() normalises referencesEntity (always lowercase from aiHelper, but defensive).
		const strategy = TYPED_REFERENCE_STRATEGIES[field.referencesEntity.toLowerCase()];
		if (strategy) {
			// Branch on numberPattern presence:
			// - ticket: has numberPattern → "ticketNumber e.g. T20240615.0674"
			// - project: no numberPattern (tenant-configurable) → "project number e.g. P20240615.0010"
			const numberClause = strategy.numberPattern
				? `${strategy.numberField} e.g. ${strategy.exampleValue}`
				: `${strategy.entityType} number e.g. ${strategy.exampleValue}`;
			parts.push(
				`(ref→${field.referencesEntity}: ID/name/${numberClause}; use ${strategy.companionFieldName})`,
			);
		} else {
			parts.push(`(ref→${field.referencesEntity}: ID or name)`);
		}
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
		throw new Error(
			`'${op}' is a grouping operator and cannot be used as a filter_op. Use filter_logic='or' for OR queries between filter pairs.`,
		);
	}
	const validKeys = (Object.keys(FilterOperators) as string[]).filter(
		(k) => k !== 'and' && k !== 'or',
	);
	const matchedKey = validKeys.find((k) => k.toLowerCase() === lower);
	if (!matchedKey) {
		throw new Error(
			`Unsupported filter operator: '${op}'. Valid operators are: ${validKeys.join(', ')}`,
		);
	}
	return (FilterOperators as Record<string, string>)[matchedKey];
}

export function getRuntimeSchemaBuilders(rz: RuntimeZod) {
	// Enum constants using runtime zod (ensures instanceof checks pass in all n8n versions)
	const rFilterOpEnum = rz.enum([
		'eq',
		'noteq',
		'gt',
		'gte',
		'lt',
		'lte',
		'contains',
		'beginsWith',
		'endsWith',
		'exist',
		'notExist',
		'in',
		'notIn',
	]);
	const rFilterValueSchema = rz
		.string()
		.describe(
			"Filter value as string. For reference/picklist fields, pass human-readable name (e.g. 'In Progress', 'Contoso', 'High') — auto-resolves to ID, or pass numeric ID directly. For in/notIn operators, comma-separate values (e.g. '1,2,3'). Booleans: 'true'/'false'.",
		);
	const rRecencySchema = rz
		.string()
		.nullish()
		.describe(
			'Preset time window: last_15m, last_1h, last_2h, last_3h, last_4h, last_6h, last_8h, last_12h, last_24h, last_1d–last_7d, last_14d, last_30d, last_90d. Or last_Nd (N=1–365). Mutually exclusive with since/until.',
		);

	function buildUnifiedSchema(
		resource: string,
		operations: string[],
		readFields: FieldMeta[],
		writeFields: FieldMeta[],
	) {
		const operationMetadata = operations
			.map((operation) => getOperationMetadata(operation))
			.filter((metadata): metadata is NonNullable<typeof metadata> => metadata !== undefined);
		const isReadOnlyOpsSet = writeFields.length === 0;
		if (isReadOnlyOpsSet) {
			const cacheKey = getReadOnlySchemaCacheKey(resource, operations, readFields);
			const cachedSchema = readOnlySchemaCache.get(cacheKey);
			if (cachedSchema) {
				traceSchemaBuild({
					phase: 'build-cache-hit',
					resource,
					summary: { cacheKey, strategy: 'read-only' },
				});
				return cachedSchema;
			}
		}

		traceSchemaBuild({
			phase: 'build-start',
			resource,
			summary: {
				operations,
				hasListFamilyOps: operations.some((op) =>
					getOperationMetadata(op)?.supportsFilters === true,
				),
				hasWriteFamilyOps: operations.some((op) => isWriteOperation(op)),
				hasIdentifierPairOps: Boolean(IDENTIFIER_PAIR_OPERATIONS[resource]),
				readFields: summariseFields(readFields),
				writeFields: summariseFields(writeFields),
			},
		});
		const allOps = [
			...new Set([...operations, 'describeFields', 'listPicklistValues', 'describeOperation']),
		] as [string, ...string[]];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const shape: Record<string, any> = {};

		const hasGetFamily = operationMetadata.some((metadata) =>
			['item', 'list', 'count'].includes(metadata.responseKind),
		);
		const hasListFamily = operationMetadata.some((metadata) => metadata.supportsFilters);
		const hasGet = operations.includes('get');
		const hasDeleteOp = operations.includes('delete');
		const hasUpdate = operations.includes('update');
		const hasCreate = operations.includes('create');
		const hasSlaHealthCheck = operations.includes('slaHealthCheck');
		const hasSummary = operations.includes('summary');
		const hasGetByCompanyAndStatus = operations.includes('getByCompanyAndStatus');
		const hasGetUnassigned = operations.includes('getUnassigned');
		const idPairConfig = IDENTIFIER_PAIR_OPERATIONS[resource];
		const idPairOps = idPairConfig
			? idPairConfig.operations.filter((op) => operations.includes(op))
			: [];
		const hasIdPairOps = idPairOps.length > 0;
		const hasGetFullDetail = operations.includes('getFullDetail');
		const fullDetailUsesIdPair = hasGetFullDetail
			&& !!idPairConfig
			&& idPairConfig.operations.includes('getFullDetail');
		const hasGetFullDetailIdOnly = hasGetFullDetail && !fullDetailUsesIdPair;

		// operation — required enum
		// NOTE: identifier-pair disambiguation lives on the id/altIdField descriptions,
		// not here. Runtime enforcement is via operation-contracts.ts xorGroups.
		const operationDesc = `Operation to perform. One of: ${allOps.join(', ')}`;
		shape.operation = rz.enum(allOps).describe(operationDesc);
		const hasSearchByIdentity = operations.includes('searchByIdentity');
		const hasSearchByDomain = operations.includes('searchByDomain');
		const hasMoveConfigItem = operations.includes('moveConfigurationItem');
		const hasMoveToCompany = operations.includes('moveToCompany');
		const hasTransferOwnership = operations.includes('transferOwnership');
		const hasApproveOrReject = operations.includes('approve') || operations.includes('reject');
		const hasReject = operations.includes('reject');
		const hasGetByResource = operations.includes('getByResource');
		const hasGetByYear = operations.includes('getByYear');

		// id — used by get, delete, update, identifier-pair ops (e.g. slaHealthCheck, summary), approve, reject, getFullDetail (id-only mode)
		if (hasGet || hasDeleteOp || hasUpdate || hasIdPairOps || hasApproveOrReject || hasGetFullDetailIdOnly) {
			const strictIdOps: string[] = [];
			if (hasGet) strictIdOps.push('get');
			if (hasDeleteOp) strictIdOps.push('delete');
			if (hasUpdate) strictIdOps.push('update');
			if (hasApproveOrReject) strictIdOps.push('approve', 'reject');
			if (hasGetFullDetailIdOnly) strictIdOps.push('getFullDetail');
			let idDesc = 'Numeric entity ID.';
			if (strictIdOps.length > 0) {
				idDesc += ` Required for: ${strictIdOps.join(', ')}.`;
			}
			if (hasIdPairOps && idPairConfig) {
				idDesc += ` Omit if using '${idPairConfig.altIdField}'.`;
			}
			shape.id = rz.number().nullish().describe(idDesc);
		}

		// resourceID — used by getByResource and getByYear (parent-path operations)
		if (hasGetByResource || hasGetByYear) {
			shape.resourceID = rz
				.union([rz.number(), rz.string()])
				.nullish()
				.describe(
					'Resource name, email, or numeric ID (auto-resolved). Required for getByResource and getByYear. ' +
					"For ticket.getByResource: searches primary (assignedResourceID) and/or secondary (TicketSecondaryResources) assignments based on mode.",
				);
		}

		// ticket.getByResource — mode field + list-family params (operation metadata marks supportsFilters:false so inject manually)
		if (hasGetByResource && resource === 'ticket') {
			if (!shape.mode) {
				shape.mode = rz
					.enum(['primary', 'secondary', 'both'])
					.nullish()
					.describe(
						"ticket.getByResource scope: 'primary' (assignedResourceID only), " +
						"'secondary' (TicketSecondaryResources only), or 'both' (default — deduplicated union, each ticket annotated with _matchedAs).",
					);
			}
			if (!shape.limit) {
				shape.limit = rz
					.number()
					.int()
					.min(1)
					.max(500)
					.nullish()
					.describe('Max records per branch (1-500, default 10). Note: combined merged result may exceed limit when mode=both.');
			}
			if (!shape.fields) {
				shape.fields = rz
					.string()
					.nullish()
					.describe(`Comma-separated field names to return. Omit for all. Call autotask_${resource} with operation 'describeFields' if unsure.`);
			}
			if (!shape.recency) shape.recency = rRecencySchema;
			if (!shape.since) {
				shape.since = rz
					.string()
					.nullish()
					.describe('Range start (ISO-8601; e.g. 2026-01-01T09:00:00Z). Overrides recency.');
			}
			if (!shape.until) {
				shape.until = rz
					.string()
					.nullish()
					.describe('Range end (ISO-8601). Requires since or recency.');
			}
			if (!shape.excludeTerminalStatuses) {
				shape.excludeTerminalStatuses = rz
					.boolean()
					.nullish()
					.describe('Exclude terminal statuses Complete/Cancelled (default true). Set false to include closed tickets.');
			}
			if (!shape.returnAll) {
				shape.returnAll = rz
					.boolean()
					.nullish()
					.describe('Fetch all matching records per branch. Default false = up to limit.');
			}
		}

		// year — used by getByYear
		if (hasGetByYear) {
			shape.year = rz
				.number()
				.int()
				.nullish()
				.describe('Calendar year (e.g. 2024). Required for getByYear operation.');
		}

		// rejectReason — used only by reject
		if (hasReject) {
			shape.rejectReason = rz
				.string()
				.nullish()
				.describe('Reason for rejecting the time off request. Recommended for audit trail.');
			shape.rejectReasonPolicy = rz
				.enum(['optional', 'mandatory'])
				.nullish()
				.describe(
					"Reject-reason policy for reject operation. 'mandatory' requires rejectReason.",
				);
		}

		// globalNotesSearch — virtual resource, custom fields only, skip all standard filter blocks
		if (resource === 'globalNotesSearch') {
			if (operations.includes('searchNotes')) {
				shape['keyword'] = rz.string().optional().describe(
					'Text to search across note titles and bodies (contains match). Applied to all 7 note entity types.',
				);
				shape['since'] = rz.string().optional().describe(
					'ISO 8601 datetime — return only notes with createDateTime >= this value.',
				);
				shape['until'] = rz.string().optional().describe(
					'ISO 8601 datetime — return only notes with createDateTime <= this value.',
				);
				shape['limit'] = rz.number().int().min(1).max(25).optional().describe(
					'Max results per note entity type (default 10, max 25). Total records = 7 × limit at most.',
				);
			}
			return rz.object(shape).strip();
		}

		// fields — column selection
		if (hasGetFamily || hasCreate) {
			shape.fields = rz
				.string()
				.nullish()
				.describe(
					`Comma-separated field names to return. Omit for all. Call autotask_${resource} with operation 'describeFields' if unsure.`,
				);
		}

		// Filter fields for list operations
		const hasSearchByKeywordForListShared = operations.includes('searchByKeyword');
		if (hasListFamily || hasSearchByKeywordForListShared) {
			const fieldNames = readFields.filter((f) => !f.udf).map((f) => f.id);
			const filterFieldDesc =
				"Field to filter on. Use operation 'describeFields' to see valid field names. For 'older than' / upper-bound date queries use filter_field with a date field + filter_op='lt'.";
			shape.filter_field =
				fieldNames.length > 0
					? rz
							.enum(fieldNames as [string, ...string[]])
							.nullish()
							.describe("Field to filter on. For 'older than' / upper-bound date queries, use a date field (createDate, lastActivityDate, dueDateTime) with filter_op='lt'.")
					: rz.string().nullish().describe(filterFieldDesc);
			shape.filter_op = rFilterOpEnum.nullish().describe("Filter operator. Use 'notExist' for unassigned/empty/null fields (no filter_value needed). Use 'exist' for populated fields. Other operators: eq (equals), noteq (not equals), gt/gte/lt/lte (numeric/date comparisons), contains/beginsWith/endsWith (text), in/notIn (array of values).");
			shape.filter_value = rFilterValueSchema.nullish();
			shape.filter_field_2 = rz
				.string()
				.nullish()
				.describe(
					'Second filter field — same valid values as filter_field. Supports date fields with filter_op_2 for bounded date ranges.',
				);
			shape.filter_op_2 = rFilterOpEnum.nullish().describe('Second filter operator');
			shape.filter_value_2 = rFilterValueSchema.nullish().describe('Second filter value');
			shape.filter_logic = rz
				.enum(['and', 'or'])
				.nullish()
				.describe(
					"Combiner between the two filter pairs: 'and' (default) or 'or'.",
				);
			shape.limit = rz
				.number()
				.int()
				.min(1)
				.max(500)
				.nullish()
				.describe('Max results (1-500, default 10)');
			shape.offset = rz
				.number()
				.int()
				.min(0)
				.nullish()
				.describe(
					'Skip first N records (0–499). Response includes hasMore/nextOffset. Max 500 total — narrow filters for more.',
				);
			shape.recency = rRecencySchema;
			const dateFields = readFields
				.filter((f) => !f.udf && f.type.toLowerCase().includes('date'))
				.map((f) => f.id);
			if (dateFields.length > 0) {
				shape.recency_field = rz
					.enum(dateFields as [string, ...string[]])
					.nullish()
					.describe(
						`Date/time field for recency/since/until. Available: ${dateFields.join(', ')}. Default: first available.`,
					);
			}
			shape.since = rz
				.string()
				.nullish()
				.describe(
					'Range start (ISO-8601; e.g. 2026-01-01T09:00:00 or 2026-01-01T09:00:00Z). Overrides recency.',
				);
			shape.until = rz
				.string()
				.nullish()
				.describe(
					'Range end (ISO-8601). Requires since or recency.',
				);
			shape.filtersJson = rz.string().nullish().describe(
					'JSON IFilterCondition array. No label resolution — use numeric IDs (call listPicklistValues for picklist IDs). Mutually exclusive with filter_field. Dates UTC.',
				);
			shape.returnAll = rz
				.boolean()
				.nullish()
				.describe(
					'Fetch ALL matching records (API pagination). Default false = up to limit. Use tight filters; subject to MAX_RESPONSE_RECORDS truncation.',
				);
			shape.outputMode = rz
				.enum(['idsAndLabels', 'rawIds'])
				.nullish()
				.describe(
					"'idsAndLabels' (default, enriched with labels) or 'rawIds' (lighter).",
				);

			// excludeTerminalStatuses — only for resources that have terminal status semantics
			if (
				RESOURCES_WITH_TERMINAL_STATUS_EXCLUSION.has(resource) &&
				operations.includes('getMany') &&
				!shape.excludeTerminalStatuses
			) {
				shape.excludeTerminalStatuses = rz
					.boolean()
					.nullish()
					.describe(
						'Exclude terminal statuses from results (default true). Set false only when user explicitly asks for completed, cancelled, or historical records.',
					);
			}
		}

		// searchByIdentity fields
		if (hasSearchByIdentity) {
			shape.companyName = rz
				.string()
				.nullish()
				.describe('Optional company name for contains matching and ranking.');
			shape.email = rz
				.string()
				.nullish()
				.describe('Optional email used to infer domain for matching.');
			shape.website = rz
				.string()
				.nullish()
				.describe('Optional website/domain used for primary domain matching.');
			shape.limit = rz
				.number()
				.int()
				.min(1)
				.max(100)
				.nullish()
				.describe('Max results (1-100, default 25).');
		}

		// searchByDomain fields
		if (hasSearchByDomain) {
			shape.domain = rz
				.string()
				.min(1)
				.nullish()
				.describe(
					"Domain to search. Prefer extracting domain from email/website first (e.g. email='user@domain.com' -> domain='domain.com'; website='https://www.domain.com/about' -> domain='domain.com'). Accepts bare domains or full URLs.",
				);
			shape.domainOperator = rz
				.enum(['eq', 'beginsWith', 'endsWith', 'contains'])
				.nullish()
				.describe(
					"Domain comparison operator (default 'contains'). When a domain is available, do domain matching first; avoid strict exact-name-only matching.",
				);
			shape.searchContactEmails = rz
				.boolean()
				.nullish()
				.describe('When true (default), fall back to contact email search if no website match.');
			shape.limit = rz
				.number()
				.int()
				.min(1)
				.max(100)
				.nullish()
				.describe('Max results (1-100, default 25).');
		}

		// slaHealthCheck fields
		if (hasSlaHealthCheck) {
			shape.ticketFields = rz
				.string()
				.nullish()
				.describe('Optional comma-separated ticket fields to return.');
		}

		// summary fields
		if (hasSummary) {
			shape.includeRaw = rz
				.boolean()
				.nullish()
				.describe(
					'Include pre-alias-rename payload: labels/UDFs intact, raw changeInfoField{N} keys, no null filtering. Use _meta.aliasMap for changeInfo mapping.',
				);
			shape.summaryTextLimit = rz
				.number()
				.nullish()
				.describe(
					'Maximum characters for description and resolution fields in the summary. Default 500. Pass 0 for no limit.',
				);
			shape.includeChildCounts = rz
				.boolean()
				.nullish()
				.describe(
					'Include childCounts block (notes, time entries, attachments, etc.). Default false — adds parallel API calls.',
				);
		}

		// timeline fields
		const hasTimeline = operations.includes('timeline');
		if (hasTimeline) {
			if (!shape.since) {
				shape.since = rz
					.string()
					.nullish()
					.describe('ISO 8601 date — filter events on or after this date');
			}
			if (!shape.until) {
				shape.until = rz
					.string()
					.nullish()
					.describe('ISO 8601 date — filter events on or before this date');
			}
			shape.resourceId = rz
				.string()
				.nullish()
				.describe('Filter by resource name or numeric ID — applies to note author, time entry resource, history actor');
			shape.includeHistories = rz
				.boolean()
				.nullish()
				.describe('Include field-change audit history events (default false — can be high volume on active tickets)');
			shape.textLimit = rz
				.number()
				.nullish()
				.describe('Max characters for note/entry text fields (default 500; 0 = no limit)');
			if (!shape.limit) {
				shape.limit = rz
					.number()
					.nullish()
					.describe('Max events per entity type — notes, time entries, histories each capped independently (default 50)');
			}
		}

		// getByCompanyAndStatus / getUnassigned shared fields
		if (hasGetByCompanyAndStatus || hasGetUnassigned) {
			if (!shape.company) {
				shape.company = rz
					.string()
					.nullish()
					.describe(
						hasGetByCompanyAndStatus
							? 'Company name or numeric companyID (auto-resolved). Required for getByCompanyAndStatus; optional for other ops.'
							: 'Company name or numeric companyID (auto-resolved). Optional — omit for all companies.',
					);
			}
			if (RESOURCES_WITH_PRIORITY.has(resource) && !shape.priority) {
				shape.priority = rz
					.string()
					.nullish()
					.describe('Priority picklist label or ID (optional).');
			}
			if (hasGetByCompanyAndStatus && !shape.status) {
				shape.status = rz
					.string()
					.nullish()
					.describe('Status picklist label or ID (optional). Omit for all statuses.');
			}
		}

		// getBySLAStatus fields
		const hasGetBySLAStatus = operations.includes('getBySLAStatus');
		if (hasGetBySLAStatus) {
			if (!shape.slaStatus) {
				shape.slaStatus = rz
					.enum(['breached', 'at_risk', 'compliant'])
					.nullish()
					.describe("Required for getBySLAStatus: 'breached' (SLA missed), 'at_risk' (within atRiskWindowHours of deadline), or 'compliant' (SLA met).");
			}
			if (!shape.atRiskWindowHours) {
				shape.atRiskWindowHours = rz
					.number()
					.nullish()
					.describe('Hours before resolvedDueDateTime to consider a ticket at-risk (default 4). Only applies when slaStatus=at_risk.');
			}
			if (!shape.company) {
				shape.company = rz
					.string()
					.nullish()
					.describe('Company name or numeric companyID (auto-resolved). Optional.');
			}
		}

		// countByPeriod fields
		const hasCountByPeriod = operations.includes('countByPeriod');
		if (hasCountByPeriod) {
			if (!shape.period) {
				shape.period = rz
					.enum(['today', 'this_week', 'last_7d', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'last_30d', 'last_90d'])
					.nullish()
					.describe('Required for countByPeriod: named period preset for createDate range.');
			}
			if (!shape.company) {
				shape.company = rz
					.string()
					.nullish()
					.describe('Company name or numeric companyID (auto-resolved). Optional.');
			}
			if (!shape.status) {
				shape.status = rz
					.string()
					.nullish()
					.describe('Status picklist label or ID (optional).');
			}
			if (RESOURCES_WITH_PRIORITY.has(resource) && !shape.priority) {
				shape.priority = rz
					.string()
					.nullish()
					.describe('Priority picklist label or ID (optional).');
			}
		}

		// getByAge fields
		const hasGetByAge = operations.includes('getByAge');
		if (hasGetByAge) {
			if (!shape.olderThanDays) {
				shape.olderThanDays = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Required for getByAge: return records older than N days (e.g. 30 for records created more than 30 days ago). Positive integer.');
			}
			if (!shape.company) shape.company = rz.string().nullish().describe('Company name or companyID (auto-resolved).');
			if (!shape.status) shape.status = rz.string().nullish().describe('Status picklist label or ID (optional).');
			if (RESOURCES_WITH_PRIORITY.has(resource) && !shape.priority) shape.priority = rz.string().nullish().describe('Priority picklist label or ID (optional).');
		}

		// searchByKeyword fields
		const hasSearchByKeyword = operations.includes('searchByKeyword');
		if (hasSearchByKeyword) {
			if (!shape.keyword) {
				shape.keyword = rz
					.string()
					.min(1)
					.nullish()
					.describe(
						"Required for searchByKeyword: keyword to search. Matches title and description (always); TicketNotes.description if includeNotes=true; TimeEntries.summaryNotes if includeTimeEntries=true. Case-insensitive 'contains' match.",
					);
			}
			if (!shape.includeNotes) {
				shape.includeNotes = rz
					.boolean()
					.nullish()
					.describe(
						'When true, also search TicketNotes.description. Default false. Adds one parallel API call. Capped at 200 matched notes.',
					);
			}
			if (!shape.includeTimeEntries) {
				shape.includeTimeEntries = rz
					.boolean()
					.nullish()
					.describe(
						'When true, also search TimeEntries.summaryNotes. Default false. Adds one parallel API call. Capped at 200 matched time entries.',
					);
			}
		}

		// Identifier-pair altIdField (e.g. ticketNumber for slaHealthCheck + summary)
		if (hasIdPairOps && idPairConfig && !shape[idPairConfig.altIdField]) {
			shape[idPairConfig.altIdField] = rz
				.string()
				.nullish()
				.describe(
					`Alt identifier for ${idPairOps.join(', ')}. Format: ${idPairConfig.altIdFormat} (e.g. ${idPairConfig.altIdExample}). Supply EITHER this OR numeric 'id' — never both. Do not send id=null alongside this field.`,
				);
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
				const base = needsLabelResolution
					? rz.string()
					: field.type === 'number'
						? rz.number()
						: field.type === 'boolean'
							? rz.boolean()
							: rz.string();
				shape[field.id] = base.nullish().describe(desc);
			}
			if (!shape.impersonationResourceId) {
				shape.impersonationResourceId = rz
					.string()
					.nullish()
					.describe(IMPERSONATION_RESOURCE_ID_DESCRIBE);
				shape.proceedWithoutImpersonationIfDenied = rz
					.boolean()
					.nullish()
					.describe(IMPERSONATION_PROCEED_DESCRIBE);
			}
		}

		// moveConfigurationItem fields
		if (hasMoveConfigItem) {
			if (!shape.sourceConfigurationItemId)
				shape.sourceConfigurationItemId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Source configuration item ID to clone.');
			if (!shape.destinationCompanyId)
				shape.destinationCompanyId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Destination company ID.');
			shape.destinationCompanyLocationId = rz
				.number()
				.int()
				.min(1)
				.nullish()
				.describe('Optional destination company location ID.');
			shape.destinationContactId = rz
				.number()
				.int()
				.min(1)
				.nullish()
				.describe('Optional destination contact ID.');
			shape.copyUdfs = rz
				.boolean()
				.nullish()
				.describe('Whether to copy user-defined fields (default true).');
			shape.copyAttachments = rz
				.boolean()
				.nullish()
				.describe('Whether to copy CI attachments (default true).');
			shape.copyNotes = rz.boolean().nullish().describe('Whether to copy notes (default true).');
			shape.copyNoteAttachments = rz
				.boolean()
				.nullish()
				.describe('Whether to copy note attachments (default true).');
			shape.deactivateSource = rz
				.boolean()
				.nullish()
				.describe('Whether to deactivate the source CI after safety checks (default true).');
			shape.idempotencyKey = rz.string().nullish().describe('Optional run key for traceability.');
			shape.includeMaskedUdfsPolicy = rz
				.enum(['omit', 'fail'])
				.nullish()
				.describe("How to handle masked UDFs: 'omit' (default) or 'fail'.");
			shape.attachmentOversizePolicy = rz
				.enum(['skip+note', 'fail'])
				.nullish()
				.describe("How to handle oversize attachments: 'skip+note' (default) or 'fail'.");
			shape.partialFailureStrategy = rz
				.enum(['deactivateDestination', 'leaveActiveWithNote'])
				.nullish()
				.describe(
					"How to handle partial failure after destination create: 'deactivateDestination' (default) or 'leaveActiveWithNote'.",
				);
			shape.retryMaxRetries = rz
				.number()
				.int()
				.min(0)
				.max(10)
				.nullish()
				.describe('Retry max attempts for transient errors (default 3).');
			shape.retryBaseDelayMs = rz
				.number()
				.int()
				.min(50)
				.max(60000)
				.nullish()
				.describe('Retry base delay in milliseconds (default 500).');
			shape.retryJitter = rz
				.boolean()
				.nullish()
				.describe('Whether to use jitter in retry backoff (default true).');
			shape.throttleMaxBytesPer5Min = rz
				.number()
				.int()
				.min(1)
				.nullish()
				.describe('Upload throughput limit in bytes per 5 minutes (default 10000000).');
			shape.throttleMaxSingleFileBytes = rz
				.number()
				.int()
				.min(1)
				.nullish()
				.describe('Maximum attachment size per file in bytes (default 6291456).');
			if (!shape.impersonationResourceId) {
				shape.impersonationResourceId = rz
					.string()
					.nullish()
					.describe(IMPERSONATION_RESOURCE_ID_DESCRIBE);
				shape.proceedWithoutImpersonationIfDenied = rz
					.boolean()
					.nullish()
					.describe(IMPERSONATION_PROCEED_DESCRIBE);
			}
		}

		// moveToCompany fields
		if (hasMoveToCompany) {
			if (!shape.sourceContactId)
				shape.sourceContactId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Source contact ID to move.');
			if (!shape.destinationCompanyId)
				shape.destinationCompanyId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Destination company ID for the cloned contact.');
			shape.destinationCompanyLocationId = rz
				.number()
				.int()
				.min(1)
				.nullish()
				.describe('Optional destination company location ID.');
			shape.skipIfDuplicateEmailFound = rz
				.boolean()
				.nullish()
				.describe(
					'Whether to skip move when duplicate email exists on destination (default true).',
				);
			shape.copyContactGroups = rz
				.boolean()
				.nullish()
				.describe('Whether to copy contact group memberships (default true).');
			shape.copyCompanyNotes = rz
				.boolean()
				.nullish()
				.describe('Whether to copy company notes linked to the contact (default true).');
			shape.copyNoteAttachments = rz
				.boolean()
				.nullish()
				.describe('Whether to copy attachments for copied notes (default true).');
			shape.sourceAuditNote = rz
				.string()
				.nullish()
				.describe('Optional audit note written to the source company context.');
			shape.destinationAuditNote = rz
				.string()
				.nullish()
				.describe('Optional audit note written to the destination company context.');
			if (!shape.impersonationResourceId) {
				shape.impersonationResourceId = rz
					.string()
					.nullish()
					.describe(IMPERSONATION_RESOURCE_ID_DESCRIBE);
				shape.proceedWithoutImpersonationIfDenied = rz
					.boolean()
					.nullish()
					.describe(IMPERSONATION_PROCEED_DESCRIBE);
			}
		}

		// transferOwnership fields
		if (hasTransferOwnership) {
			if (!shape.sourceResourceId)
				shape.sourceResourceId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Source resource ID currently assigned to work. Can be inactive.');
			if (!shape.destinationResourceId)
				shape.destinationResourceId = rz
					.number()
					.int()
					.min(1)
					.nullish()
					.describe('Receiving resource ID. Must be active.');
			shape.includeTickets = rz
				.boolean()
				.nullish()
				.describe('Whether to include tickets (default false).');
			shape.includeProjects = rz
				.boolean()
				.nullish()
				.describe('Whether to include projects (default false).');
			shape.includeServiceCallAssignments = rz
				.boolean()
				.nullish()
				.describe('Whether to reassign service call task/ticket resources (default false).');
			shape.includeAppointments = rz
				.boolean()
				.nullish()
				.describe('Whether to reassign appointments (default false).');
			shape.includeCompanies = rz
				.boolean()
				.nullish()
				.describe('Whether to transfer companies owned by the source resource (default false).');
			shape.companyIdAllowlist = rz
				.string()
				.nullish()
				.describe('Optional comma-separated company IDs to scope company transfer.');
			shape.includeOpportunities = rz
				.boolean()
				.nullish()
				.describe(
					'Whether to transfer opportunities owned by the source resource (default false).',
				);
			shape.dueWindowPreset = rz
				.enum([
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
				])
				.nullish()
				.describe("Optional due window preset. Use 'custom' with dueBeforeCustom.");
			shape.dueBeforeCustom = rz
				.string()
				.nullish()
				.describe(
					"Required when dueWindowPreset is 'custom'. Accepts YYYY-MM-DD or ISO-8601 datetime.",
				);
			shape.onlyOpenActive = rz
				.boolean()
				.nullish()
				.describe('When true, excludes terminal statuses (default true).');
			shape.includeItemsWithNoDueDate = rz
				.boolean()
				.nullish()
				.describe(
					'Whether items with no due date are included (default true, unless due window is set).',
				);
			shape.ticketAssignmentMode = rz
				.enum(['primaryOnly', 'primaryAndSecondary'])
				.nullish()
				.describe('Ticket assignment scope (default primaryOnly).');
			shape.projectReassignMode = rz
				.enum([
					'leadOnly',
					'leadAndTasks',
					'leadTasksAndSecondary',
					'tasksOnly',
					'tasksAndSecondary',
				])
				.nullish()
				.describe('Project reassignment scope (default leadAndTasks).');
			shape.maxItemsPerEntity = rz
				.number()
				.int()
				.min(1)
				.max(10000)
				.nullish()
				.describe('Safety cap per entity type (default 500).');
			shape.maxCompanies = rz
				.number()
				.int()
				.min(1)
				.max(10000)
				.nullish()
				.describe('Safety cap for companies (default 500).');
			shape.statusAllowlistByLabel = rz
				.string()
				.nullish()
				.describe('Optional comma-separated status labels to include.');
			shape.statusAllowlistByValue = rz
				.string()
				.nullish()
				.describe('Optional comma-separated status integer values to include.');
			shape.addAuditNotes = rz
				.boolean()
				.nullish()
				.describe('Whether to create per-entity audit notes (default false).');
			shape.auditNoteTemplate = rz
				.string()
				.nullish()
				.describe(
					'Audit note template with placeholders: {sourceResourceName}, {sourceResourceId}, {destinationResourceName}, {destinationResourceId}, {date}, {entityType}, {entityId}.',
				);
			if (!shape.impersonationResourceId) {
				shape.impersonationResourceId = rz
					.string()
					.nullish()
					.describe(IMPERSONATION_RESOURCE_ID_DESCRIBE);
				shape.proceedWithoutImpersonationIfDenied = rz
					.boolean()
					.nullish()
					.describe(IMPERSONATION_PROCEED_DESCRIBE);
			}
		}

		// getAvailableRoles fields
		if (operations.includes('getAvailableRoles')) {
			if (!shape.resourceID) {
				shape.resourceID = rz.union([rz.number(), rz.string()]).describe(
					'Required. The resource (technician) ID or name to find available roles for.'
				);
			}
			if (!shape.ticketID) {
				shape.ticketID = rz.number().optional().describe(
					'Ticket ID. If provided, derives queueID and contractID from the ticket automatically.'
				);
			}
			if (!shape.queueID) {
				shape.queueID = rz.number().optional().describe(
					'Queue ID to filter roles by. Use when ticketID is not available.'
				);
			}
			if (!shape.contractID) {
				shape.contractID = rz.number().optional().describe(
					'Contract ID to apply exclusion rules. If ticketID is provided this is derived automatically.'
				);
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
					const base = needsLabelResolution
						? rz.string()
						: field.type === 'number'
							? rz.number()
							: field.type === 'boolean'
								? rz.boolean()
								: rz.string();
					shape[field.id] = base.nullish().describe(desc);
				}
			}
			// createIfNotExists-specific fields
			if (!shape.dedupFields)
				shape.dedupFields = rz
					.array(rz.string())
					.nullish()
					.describe(
						'Field names for duplicate detection (use describeFields to discover). Empty = always create.',
					);
			if (!shape.updateFields)
				shape.updateFields = rz
					.array(rz.string())
					.nullish()
					.describe(
						'Field names to update if a duplicate differs from the target. Empty = skip update. Ignored when errorOnDuplicate is true.',
					);
			if (!shape.errorOnDuplicate)
				shape.errorOnDuplicate = rz
					.boolean()
					.nullish()
					.describe(
						"If true, error on duplicate instead of returning outcome: skipped. Default false.",
					);
			if (!shape.impersonationResourceId) {
				shape.impersonationResourceId = rz
					.string()
					.nullish()
					.describe(IMPERSONATION_RESOURCE_ID_DESCRIBE);
				shape.proceedWithoutImpersonationIfDenied = rz
					.boolean()
					.nullish()
					.describe(IMPERSONATION_PROCEED_DESCRIBE);
			}
		}

		// describeFields fields
		shape.mode = rz
			.enum(['read', 'write'])
			.nullish()
			.describe(
				"Field mode for describeFields: 'read' for get/getMany, 'write' for create/update.",
			);

		// listPicklistValues fields
		shape.fieldId = rz
			.string()
			.nullish()
			.describe(
				'Field ID. Required for listPicklistValues.',
			);
		shape.query = rz
			.string()
			.nullish()
			.describe('Search term to filter picklist values.');
		if (!shape.limit) {
			shape.limit = rz
				.number()
				.nullish()
				.describe('Max results (used by listPicklistValues for pagination, default 50).');
		}
		shape.page = rz
			.number()
			.nullish()
			.describe('Page for listPicklistValues (default 1).');
		shape.targetOperation = rz
			.string()
			.nullish()
			.describe(
				"For describeOperation: the operation name to document (e.g. 'create').",
			);

		// Typed-reference companion fields (ticketLookupField, projectLookupField, …).
		// Emitted outside the hasCreate||hasUpdate block so they are available on
		// read-only tools too — the filter path uses them on getMany.
		const allFields = [...writeFields, ...readFields];
		for (const strategy of Object.values(TYPED_REFERENCE_STRATEGIES)) {
			const hasMatchingField = allFields.some(
				(f) =>
					f.isReference &&
					f.referencesEntity?.toLowerCase() === strategy.entityType,
			);
			if (!hasMatchingField) continue;
			if (strategy.companionFieldName in shape) continue; // de-dup guard
			shape[strategy.companionFieldName] = rz
				.enum(strategy.searchableFields)
				.nullish()
				.describe(
					`Search field for ${strategy.entityType} lookup when ${strategy.entityType}ID is a non-numeric label. ` +
					`E.g. set to '${strategy.searchableFields[0]}' to find by name. ` +
					`Not needed when supplying a ${strategy.entityType} number (${strategy.exampleValue}).`,
				);
		}

		traceSchemaBuild({
			phase: 'build-complete',
			resource,
			summary: {
				topLevelSchemaKeys: safeKeys(shape),
				dynamicWriteFieldCount: writeFields.filter(
					(field) =>
						field.id !== 'id' &&
						!Object.prototype.hasOwnProperty.call({ operation: true }, field.id),
				).length,
				readEnumFilterFieldCount: readFields.filter((field) => !field.udf).length,
				exposesFiltersJson: Boolean(shape.filtersJson),
				exposesReturnAll: Boolean(shape.returnAll),
				exposesOutputMode: Boolean(shape.outputMode),
				// AI schema no longer exposes dryRun (UI-node dry-run remains in non-AI paths).
				exposesDryRun: false,
				exposesImpersonationResourceId: Boolean(shape.impersonationResourceId),
			},
		});
		const schema = rz.object(shape);
		if (isReadOnlyOpsSet) {
			const cacheKey = getReadOnlySchemaCacheKey(resource, operations, readFields);
			setReadOnlySchemaCache(cacheKey, schema);
		}
		return schema;
	}

	return { buildUnifiedSchema };
}
