import type {
	IExecuteFunctions,
	IGetNodeParameterOptions,
	ILoadOptionsFunctions,
	IDataObject,
} from 'n8n-workflow';
import { executeToolOperation } from '../resources/tool/execute';
import type { FieldMeta } from '../helpers/aiHelper';
import { describeResource, listPicklistValues } from '../helpers/aiHelper';
import { validateEntityId, validateReadFields, validateWriteFields } from './field-validator';
import {
	formatApiError,
	formatFilterConstraintError,
	formatIdError,
	wrapError,
	ERROR_TYPES,
	type FlatErrorResponse,
} from './error-formatter';
import {
	resolveLabelsToIds,
	type LabelResolution,
	type PendingLabelConfirmation,
} from '../helpers/label-resolution';
import { TYPED_REFERENCE_COMPANION_FIELDS } from '../helpers/typed-reference';
import {
	applyChangeInfoAliases,
	buildAliasMap,
	shouldApplyAliases,
} from '../helpers/change-info-aliases';
import { buildOperationDoc } from './description-builders';
import { getIdentifierPairConfig } from '../constants/resource-operations';
import { getConfiguredTimezone, convertDatesToUTC } from '../helpers/date-time/utils';
import {
	buildRecencyFilters,
	type RecencyBuildResult,
	AUTO_RETURN_ALL_WINDOW_MS,
	formatRecencyWindowLabel,
} from './recency';
import {
	attachCorrelation,
	buildListResponse,
	buildItemResponse,
	buildMetadataResponse,
	buildCompoundResponse,
	buildCountResponse,
	type ToolResponseContext,
} from './response-builder';
import {
	dispatchOperationResponse,
	MAX_RESPONSE_RECORDS,
} from './operation-handlers/operation-dispatch';
import { CountOperation } from '../operations/base/count-operation';
import type { IAutotaskEntity } from '../types';
import {
	buildFieldLookup,
	buildFilterFromParams,
	resolveAndClassifyFilters,
	type ToolFilter,
} from './filter-builder';
import type { IAutotaskCredentials } from '../types/base/auth';
import {
	AI_TOOL_DEBUG_VERBOSE,
	redactForVerbose,
	safeKeys,
	summariseFilters,
	summariseResponseEnvelope,
	traceError,
	traceExecutor,
	traceFilterBuild,
	traceLabelResolution,
	traceResponse,
	traceToolCall,
} from './debug-trace';
import { buildWriteResolutionBlocker, summariseResolutionState } from './write-guard';
import {
	COMPOUND_REGISTRY,
	COMPOUND_PARENT_NOT_FOUND_OUTCOMES,
} from '../constants/compound-registry';
import { validateOperationContract, hasProvidedValue, type OperationContractViolation } from './operation-contracts';
import { enrichResponseJson } from '../helpers/enrichment';
import { autotaskApiRequest } from '../helpers/http';

export interface ToolExecutorParams {
	resource: string;
	operation: string;
	id?: number;
	ticketNumber?: string;
	ticketFields?: string;
	filter_field?: string;
	filter_op?: string;
	filter_value?: string | number | boolean | Array<string | number | boolean>;
	filter_field_2?: string;
	filter_op_2?: string;
	filter_value_2?: string | number | boolean | Array<string | number | boolean>;
	filter_logic?: 'and' | 'or';
	limit?: number;
	offset?: number;
	fields?: string;
	recency?: string;
	recency_field?: string;
	since?: string;
	until?: string;
	domain?: string;
	domainOperator?: string;
	searchContactEmails?: boolean;
	filtersJson?: string;
	returnAll?: boolean;
	targetOperation?: string;
	company?: string | number;
	status?: string | number;
	priority?: string | number;
	[key: string]: string | number | boolean | Array<string | number | boolean> | undefined;
}

export interface ToolExecutionMetadata {
	readFields?: FieldMeta[];
	writeFields?: FieldMeta[];
	allAllowedOps?: string[];
}

interface ResourceConvenienceConfig {
	queryEndpoint: string;
	getEndpoint: (id: string | number) => string;
	createDateField: string;
	assignedField: string;
	terminalStatusIds: number[];
	hasPriority: boolean;
	hasCompanyId: boolean;
	companyFilterStrategy: 'direct' | 'viaProject';
	supportsSLA: boolean;
	getFullDetailMode: 'sla' | 'simple';
	childCountEntities: Array<{
		queryEndpoint: string;
		parentField: string;
		key: string;
	}>;
}

const RESOURCE_CONVENIENCE_CONFIG: Record<string, ResourceConvenienceConfig> = {
	ticket: {
		queryEndpoint: 'Tickets/query',
		getEndpoint: (id) => `Tickets/${id}`,
		createDateField: 'createDate',
		assignedField: 'assignedResourceID',
		terminalStatusIds: [5, 8],
		hasPriority: true,
		hasCompanyId: true,
		companyFilterStrategy: 'direct',
		supportsSLA: true,
		getFullDetailMode: 'sla',
		childCountEntities: [
			{ queryEndpoint: 'TicketNotes/query',              parentField: 'ticketID', key: 'notes' },
			{ queryEndpoint: 'TicketSecondaryResources/query', parentField: 'ticketID', key: 'secondaryResources' },
			{ queryEndpoint: 'TicketCharges/query',            parentField: 'ticketID', key: 'charges' },
			{ queryEndpoint: 'TimeEntries/query',              parentField: 'ticketID', key: 'timeEntries' },
			{ queryEndpoint: 'TicketChecklistItems/query',     parentField: 'ticketID', key: 'checklistItems' },
			{ queryEndpoint: 'TicketAdditionalContacts/query', parentField: 'ticketID', key: 'additionalContacts' },
		],
	},
	task: {
		queryEndpoint: 'Tasks/query',
		getEndpoint: (id) => `Tasks/${id}`,
		createDateField: 'createDateTime',
		assignedField: 'assignedResourceID',
		terminalStatusIds: [5],
		hasPriority: false,
		hasCompanyId: false,
		companyFilterStrategy: 'viaProject',
		supportsSLA: false,
		getFullDetailMode: 'simple',
		childCountEntities: [
			{ queryEndpoint: 'TaskNotes/query',              parentField: 'taskID',    key: 'notes' },
			{ queryEndpoint: 'TaskSecondaryResources/query', parentField: 'taskID',    key: 'secondaryResources' },
			{ queryEndpoint: 'TimeEntries/query',            parentField: 'taskID',    key: 'timeEntries' },
		],
	},
	project: {
		queryEndpoint: 'Projects/query',
		getEndpoint: (id) => `Projects/${id}`,
		createDateField: 'createDateTime',
		assignedField: 'projectLeadResourceID',
		terminalStatusIds: [5],
		hasPriority: false,
		hasCompanyId: true,
		companyFilterStrategy: 'direct',
		supportsSLA: false,
		getFullDetailMode: 'simple',
		childCountEntities: [
			{ queryEndpoint: 'ProjectNotes/query',   parentField: 'projectID', key: 'notes' },
			{ queryEndpoint: 'ProjectCharges/query', parentField: 'projectID', key: 'charges' },
			{ queryEndpoint: 'Tasks/query',          parentField: 'projectID', key: 'tasks' },
			{ queryEndpoint: 'Phases/query',         parentField: 'projectID', key: 'phases' },
		],
	},
};

function getConvenienceConfig(resource: string): ResourceConvenienceConfig | undefined {
	return RESOURCE_CONVENIENCE_CONFIG[resource];
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

export const DEFAULT_QUERY_LIMIT = 10;
export const MAX_QUERY_LIMIT = 500;
export const RECENCY_OVER_REQUEST_LIMIT = 500;

export function getEffectiveLimit(limit: number | undefined): number {
	if (typeof limit !== 'number' || Number.isNaN(limit)) {
		return DEFAULT_QUERY_LIMIT;
	}
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_QUERY_LIMIT);
}

/**
 * Build field values for create/update from params.
 * Only includes actual entity field values, excluding control params.
 */
function buildFieldValues(
	params: ToolExecutorParams,
	excludeKeys: string[],
	writeFields: FieldMeta[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const writeFieldLookup = buildFieldLookup(writeFields);
	const exclude = new Set<string>([
		...excludeKeys,
		'resource',
		'operation',
		'filter_field',
		'filter_op',
		'filter_value',
		'filter_field_2',
		'filter_op_2',
		'filter_value_2',
		'filter_logic',
		'limit',
		'offset',
		'fields',
		'recency',
		'recency_field',
		'since',
		'until',
		'domain',
		'domainOperator',
		'searchContactEmails',
		'impersonationResourceId',
		'proceedWithoutImpersonationIfDenied',
		'dedupFields',
		'errorOnDuplicate',
		'updateFields',
		'outputMode',
		'targetOperation',
		'filtersJson',
		'returnAll',
		'company',
		// Companion fields for typed-reference resolution (ticketLookupField, projectLookupField, ...).
		// These are schema fields consumed by the resolver, never sent to the API.
		...Array.from(TYPED_REFERENCE_COMPANION_FIELDS),
	]);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== '' && !exclude.has(key)) {
			const canonicalField = writeFieldLookup.get(key.toLowerCase());
			result[canonicalField?.id ?? key] = value;
		}
	}
	return result;
}

/**
 * Parse the 'fields' param into a selectColumns-compatible array.
 */
function parseFieldsParam(fields: string | undefined): string[] {
	if (!fields || typeof fields !== 'string') return [];
	return fields
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean);
}

/**
 * Normalise operation names to canonical forms used by the executor.
 */
function normaliseOperation(operation: string): string {
	const key = operation.trim().toLowerCase();
	switch (key) {
		case 'getmany':
			return 'getMany';
		case 'whoami':
			return 'whoAmI';
		case 'getposted':
			return 'getPosted';
		case 'getunposted':
			return 'getUnposted';
		case 'searchbydomain':
			return 'searchByDomain';
		case 'searchbyidentity':
			return 'searchByIdentity';
		case 'slahealthcheck':
			return 'slaHealthCheck';
		case 'moveconfigurationitem':
			return 'moveConfigurationItem';
		case 'movetocompany':
			return 'moveToCompany';
		case 'transferownership':
			return 'transferOwnership';
		case 'createifnotexists':
			return 'createIfNotExists';
		case 'getbyresource':
			return 'getByResource';
		case 'getavailableroles':
			return 'getAvailableRoles';
		case 'getbyyear':
			return 'getByYear';
		case 'describeoperation':
			return 'describeOperation';
		case 'describefields':
			return 'describeFields';
		case 'listpicklistvalues':
			return 'listPicklistValues';
		default:
			return key;
	}
}

/** n8n framework fields injected into every tool call — must not reach API request bodies. */
export const N8N_METADATA_FIELDS = new Set([
	'sessionId',
	'action',
	'chatInput',
	'root',
	'tool',
	'toolName',
	'toolCallId',
	'operation',
	'dryRun', // Defensive strip: AI/MCP no longer accepts dry-run, but ignore if injected.
]);

/** Key prefixes injected by n8n that must be stripped regardless of suffix */
export const N8N_METADATA_PREFIXES = ['Prompt__'];

/** Extract the canonical created-entity numeric ID from a compound creator result. */
 
function buildCompoundEntityId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.entityIdField;
	return field ? result[field] : (result.id ?? result.itemId);
}

/** Extract the canonical existing-entity numeric ID from a compound creator result (skip/update). */
 
function buildCompoundExistingId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.existingIdField;
	return field ? result[field] : result.existingId;
}

/** Build the context block (parent/scope fields) for a compound creator result. */
 
function buildCompoundContext(resource: string, result: any): Record<string, unknown> | undefined {
	switch (resource) {
		case 'contractCharge':
			return result.contractId !== undefined ? { contractId: result.contractId } : undefined;
		case 'ticketCharge':
			return { ticketId: result.ticketId, ticketID: result.ticketID };
		case 'projectCharge':
			return result.projectId !== undefined ? { projectId: result.projectId } : undefined;
		case 'configurationItems':
			return { companyID: result.companyID };
		case 'timeEntry': {
			const ctx: Record<string, unknown> = { resourceID: result.resourceID };
			if (result.ticketID !== undefined) ctx.ticketID = result.ticketID;
			if (result.taskID !== undefined) ctx.taskID = result.taskID;
			return ctx;
		}
		case 'contractService':
			return result.contractId !== undefined ? { contractId: result.contractId } : undefined;
		case 'contract':
			return { companyID: result.companyID };
		case 'opportunity':
			return undefined;
		case 'expenseItem':
			return { expenseReportID: result.expenseReportID };
		case 'ticketAdditionalConfigurationItem':
			return result.ticketID !== undefined ? { ticketID: result.ticketID } : undefined;
		case 'ticketAdditionalContact':
			return result.ticketID !== undefined ? { ticketID: result.ticketID } : undefined;
		case 'changeRequestLink': {
			const ctx: Record<string, unknown> = {};
			if (result.changeRequestTicketID !== undefined)
				ctx.changeRequestTicketID = result.changeRequestTicketID;
			if (result.problemOrIncidentTicketID !== undefined)
				ctx.problemOrIncidentTicketID = result.problemOrIncidentTicketID;
			return Object.keys(ctx).length > 0 ? ctx : undefined;
		}
		case 'holidaySet':
			return undefined;
		case 'holiday':
			return result.holidaySetId !== undefined ? { holidaySetId: result.holidaySetId } : undefined;
		default:
			return undefined;
	}
}

function buildContractViolationNextAction(
	resource: string,
	operation: string,
	violations: OperationContractViolation[],
): string {
	return (
		`Call autotask_${resource} with operation '${operation}' and ensure: ` +
		violations.map((v) => v.message).join(' ')
	);
}

// Used for count-injection. Must NOT route through executeToolOperation — the two would
// share (and race on) the same context.getNodeParameter override.
async function executeCountOperation(
	resource: string,
	filters: unknown[],
	context: IExecuteFunctions,
): Promise<number | null> {
	try {
		const scopedContext = Object.create(context) as IExecuteFunctions;
		scopedContext.getNodeParameter = ((
			name: string,
			_index: number,
			fallback?: unknown,
		): unknown => {
			if (name === 'filtersFromTool') return filters;
			if (name === 'returnAll') return false;
			if (name === 'id') return null;
			return context.getNodeParameter(name, 0, fallback);
		}) as IExecuteFunctions['getNodeParameter'];
		const countOp = new CountOperation<IAutotaskEntity>(resource, scopedContext);
		return await countOp.execute(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.debug('[executeCountOperation] count call failed:', message);
		return null;
	}
}

/**
 * Execute an Autotask operation by routing to the existing tool executor
 * with getNodeParameter overridden to map flat AI tool params.
 */
export async function executeAiTool(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	rawParams: ToolExecutorParams,
	metadata: ToolExecutionMetadata = {},
): Promise<string> {
	const startedAt = Date.now();
	const rawCorrelation = rawParams.toolCallId ?? rawParams.sessionId;
	const correlationId: string | undefined =
		typeof rawCorrelation === 'string' && rawCorrelation.trim()
			? rawCorrelation.trim()
			: typeof rawCorrelation === 'number'
				? String(rawCorrelation)
				: undefined;

	// Strip n8n framework metadata injected into every tool call
	const params = {} as ToolExecutorParams;
	const strippedMetadataKeys: string[] = [];
	for (const [key, value] of Object.entries(rawParams)) {
		if (N8N_METADATA_FIELDS.has(key) || N8N_METADATA_PREFIXES.some((p) => key.startsWith(p))) {
			strippedMetadataKeys.push(key);
			continue;
		}
		(params as Record<string, unknown>)[key] = value;
	}
	// Normalise null → undefined for all params: null from the LLM (via .nullish() schema fields)
	// must be treated as "field not provided" — never forwarded to API bodies or filter coercion.
	for (const key of Object.keys(params)) {
		if ((params as Record<string, unknown>)[key] === null) {
			delete (params as Record<string, unknown>)[key];
		}
	}
	// Normalise sentinel-string values for identifier fields. Some LLMs pass the literal string
	// "null", "undefined", or "" for id/ticketNumber when they mean "absent" — these are truthy
	// and would incorrectly pass the identifier-pair XOR guard (both id and altId appearing
	// provided). Treat them as absent before the pre-flight contract check.
	const SENTINEL_ABSENT_STRINGS = new Set(['null', 'undefined', '']);
	const identifierKeys = ['id', 'ticketNumber'];
	for (const key of identifierKeys) {
		const value = (params as Record<string, unknown>)[key];
		if (typeof value === 'string' && SENTINEL_ABSENT_STRINGS.has(value.trim().toLowerCase())) {
			delete (params as Record<string, unknown>)[key];
		}
	}
	// Strip empty-string filter values — treat as "not provided" so notExist/exist operators
	// work without the model needing to supply a placeholder value.
	for (const key of ['filter_value', 'filter_value_2']) {
		const value = (params as Record<string, unknown>)[key];
		if (typeof value === 'string' && value.trim() === '') {
			delete (params as Record<string, unknown>)[key];
		}
	}
	const normalisedOperation = normaliseOperation(operation);
	traceToolCall({
		phase: 'execute-start',
		resource,
		operation: normalisedOperation,
		correlationId,
		summary: {
			rawOperation: operation,
			normalisedOperation,
			rawParamKeys: safeKeys(rawParams),
			sanitisedParamKeys: safeKeys(params),
			strippedMetadataKeys,
			...(AI_TOOL_DEBUG_VERBOSE ? { paramsSnapshot: redactForVerbose(params) } : {}),
		},
	});

	const timezone = await getConfiguredTimezone.call(context);

	const originalGetNodeParameter = context.getNodeParameter.bind(context);
	const readFields = metadata.readFields ?? [];
	const writeFields = metadata.writeFields ?? [];
	const fieldValues = buildFieldValues(params, ['id'], writeFields);
	const filters = buildFilterFromParams(params, readFields, timezone, resource);
	const entityId = params.id !== undefined ? String(params.id) : '';

	const {
		resolutions: filterResolutions,
		warnings: filterWarnings,
		pendingConfirmations: filterPendingConfirmations,
		unresolvedIdLikeFilters,
		unresolvedIdLikeFilterDetails,
	} = await resolveAndClassifyFilters(
		context,
		resource,
		filters,
		readFields,
		params as IDataObject,
	);
	traceLabelResolution({
		phase: 'filter-resolution',
		resource,
		operation: normalisedOperation,
		correlationId,
		summary: {
			attempted: filters.length > 0,
			unresolvedIdLikeFilterCount: unresolvedIdLikeFilters.length,
			unresolvedIdLikeFilterFields: unresolvedIdLikeFilters.map((filter) => filter.field),
			unresolvedIdLikeFilterDetails,
			...summariseResolutionState(filterResolutions, filterWarnings, filterPendingConfirmations),
			...(AI_TOOL_DEBUG_VERBOSE ? { filterSnapshot: redactForVerbose(filters) } : {}),
		},
	});
	// Surface filter-field alias corrections so the model learns canonical names
	for (const f of filters) {
		if (f.aliasedFrom) {
			filterWarnings.push(
				`Filter field '${f.aliasedFrom}' is not a real field — auto-corrected to '${f.field}'. Use '${f.field}' directly in future calls.`,
			);
		}
	}
	const selectedColumns = parseFieldsParam(params.fields);
	const selectedSlaTicketColumns = parseFieldsParam(params.ticketFields);
	const effectiveLimit = getEffectiveLimit(params.limit);
	const effectiveOffset =
		typeof params.offset === 'number' && Number.isFinite(params.offset) && params.offset >= 0
			? Math.trunc(params.offset)
			: 0;

	// Handle helper operations that bypass the standard executor
	if (normalisedOperation === 'describeFields') {
		try {
			const mode = (params.mode as 'read' | 'write') ?? 'read';
			const result = await describeResource(
				context as unknown as ILoadOptionsFunctions,
				resource,
				mode,
			);
			const responseJson = JSON.stringify(
				buildMetadataResponse(resource, 'describeFields', {
					kind: 'describeFields',
					fields: result.fields,
					mode,
				}),
			);
			traceResponse({
				phase: 'helper-describeFields',
				resource,
				operation: 'describeFields',
				correlationId,
				durationMs: Date.now() - startedAt,
				summary: summariseResponseEnvelope(responseJson),
			});
			return attachCorrelation(responseJson, correlationId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			traceError({
				phase: 'helper-describeFields',
				resource,
				operation: 'describeFields',
				correlationId,
				summary: { errorMessage: message, beforeApiCall: false },
			});
			return attachCorrelation(
				JSON.stringify(formatApiError(message, resource, 'describeFields')),
				correlationId,
			);
		}
	}
	if (normalisedOperation === 'listPicklistValues') {
		const fieldId = typeof params.fieldId === 'string' ? params.fieldId.trim() : '';
		if (!fieldId) {
			const targetOpProvided = typeof params.targetOperation === 'string' && (params.targetOperation as string).trim() !== '';
			const hint = targetOpProvided
				? `'targetOperation' is for the 'describeOperation' helper, not 'listPicklistValues'. Pass 'fieldId' set to the picklist field name (e.g. 'status', 'priority').`
				: `'fieldId' is required — pass the picklist field name (e.g. 'status', 'priority').`;
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						'listPicklistValues',
						ERROR_TYPES.MISSING_REQUIRED_FIELDS,
						hint,
						`Call autotask_${resource} with operation 'describeFields' to find picklist field names, then retry with fieldId='<fieldName>'.`,
						undefined,
						['describeFields'],
					),
				),
				correlationId,
			);
		}
		try {
			const result = await listPicklistValues(
				context as unknown as ILoadOptionsFunctions,
				resource,
				params.fieldId as string,
				params.query as string | undefined,
				(params.limit as number) ?? 50,
				(params.page as number) ?? 1,
			);
			return attachCorrelation(
				JSON.stringify(
					buildMetadataResponse(resource, 'listPicklistValues', {
						kind: 'listPicklistValues',
						fieldId: params.fieldId as string,
						picklistValues: result.values,
					}),
				),
				correlationId,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return attachCorrelation(
				JSON.stringify(formatApiError(message, resource, 'listPicklistValues')),
				correlationId,
			);
		}
	}
	if (normalisedOperation === 'describeOperation') {
		try {
			const target = params.targetOperation as string | undefined;
			const allAllowedOps = metadata.allAllowedOps ?? [];
			if (!target || !allAllowedOps.includes(target)) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'describeOperation',
							ERROR_TYPES.INVALID_OPERATION,
							`'targetOperation' must be one of: ${allAllowedOps.join(', ')}`,
							`Call autotask_${resource} with operation='describeOperation' and a valid targetOperation value.`,
						),
					),
					correlationId,
				);
			}
			const doc = buildOperationDoc(resource, target, readFields, writeFields);
			return attachCorrelation(
				JSON.stringify(
					buildMetadataResponse(resource, 'describeOperation', {
						kind: 'describeOperation',
						operationDoc: doc,
						targetOperation: target as string,
					}),
				),
				correlationId,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return attachCorrelation(
				JSON.stringify(formatApiError(message, resource, 'describeOperation')),
				correlationId,
			);
		}
	}

	let recencyResult: RecencyBuildResult;
	try {
		recencyResult = buildRecencyFilters(params, readFields, timezone);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return attachCorrelation(
			JSON.stringify(
				formatFilterConstraintError(
					resource,
					normalisedOperation,
					detail,
					"Use recency windows (for example 'last_7d') or date/time strings for since/until (e.g. 2026-01-15T09:00:00 in your configured timezone, or 2026-01-15T09:00:00Z with explicit UTC offset).",
				),
			),
			correlationId,
		);
	}
	if (recencyResult.note && !recencyResult.isActive) {
		return attachCorrelation(
			JSON.stringify(
				formatFilterConstraintError(
					resource,
					normalisedOperation,
					recencyResult.note,
					`No datetime field was detected for ${resource}. Use explicit filter_field/filter_value pairs with a known date field, or call autotask_${resource} with operation 'describeFields' with mode 'read' to discover available date fields.`,
				),
			),
			correlationId,
		);
	}

	const isShortWindow =
		recencyResult.isActive &&
		recencyResult.windowMs !== null &&
		recencyResult.windowMs <= AUTO_RETURN_ALL_WINDOW_MS;

	const effectiveReturnAll = params.returnAll === true || isShortWindow;
	const autoReturnAll = isShortWindow && params.returnAll !== true;

	 
	let combinedFilters: any[];
	if (params.filtersJson) {
		// filtersJson path — mutually exclusive with flat filter triplets
		if (params.filter_field || params.filter_field_2) {
			return attachCorrelation(
				JSON.stringify(
					formatFilterConstraintError(
						resource,
						normalisedOperation,
						'filtersJson is mutually exclusive with filter_field/filter_field_2. Provide one or the other, not both.',
						'Remove filter_field and filter_field_2 when using filtersJson, or remove filtersJson when using flat triplets.',
					),
				),
				correlationId,
			);
		}
		 
		let parsedFiltersJson: any[] = [];
		try {
			const parsed: unknown = JSON.parse(params.filtersJson as string);
			if (!Array.isArray(parsed)) throw new Error('filtersJson must be a JSON array.');
			parsedFiltersJson = parsed;
		} catch (e) {
			return attachCorrelation(
				JSON.stringify(
					formatFilterConstraintError(
						resource,
						normalisedOperation,
						`filtersJson parse error: ${e instanceof Error ? e.message : String(e)}`,
						'Provide a valid JSON array of Autotask IFilterCondition objects. Example: \'[{"field":"status","op":"eq","value":1}]\'',
					),
				),
				correlationId,
			);
		}
		if (
			parsedFiltersJson.some((f) => typeof f !== 'object' || f === null || !('op' in (f as object)))
		) {
			return attachCorrelation(
				JSON.stringify(
					formatFilterConstraintError(
						resource,
						normalisedOperation,
						'filtersJson validation error: each element must have at minimum an "op" property.',
						"Each filter object requires at minimum an 'op' property (e.g. 'eq', 'or', 'and'). Field-level filters also need 'field' and 'value'.",
					),
				),
				correlationId,
			);
		}
		// Recency always AND-appended on top (time window constraint)
		combinedFilters = [...parsedFiltersJson, ...recencyResult.filters];
	} else {
		// Standard flat-triplet filter path
		const filterLogic = params.filter_logic === 'or' ? 'or' : 'and';
		if (filterLogic === 'or' && filters.length >= 2 && recencyResult.filters.length > 0) {
			// OR between user filters, AND with recency
			combinedFilters = [{ op: 'or', items: [...filters] }, ...recencyResult.filters];
		} else if (filterLogic === 'or' && filters.length >= 2) {
			combinedFilters = [{ op: 'or', items: [...filters] }];
		} else {
			combinedFilters = [...filters, ...recencyResult.filters];
		}
	}
	// Auto-exclude terminal statuses for getMany on ticket/task/project unless explicitly disabled
	if (
		normalisedOperation === 'getMany' &&
		params.excludeTerminalStatuses !== false &&
		!params.filtersJson // filtersJson path is unmanaged — user controls filters entirely
	) {
		const convenienceCfg = getConvenienceConfig(resource);
		if (convenienceCfg && convenienceCfg.terminalStatusIds.length > 0) {
			combinedFilters = [
				...combinedFilters,
				{ field: 'status', op: 'notIn', value: convenienceCfg.terminalStatusIds },
			];
		}
	}

	traceFilterBuild({
		phase: 'combined-filters',
		resource,
		operation: normalisedOperation,
		correlationId,
		summary: {
			flatFilters: summariseFilters(filters),
			recencyFilters: summariseFilters(recencyResult.filters),
			recencyDateRange: recencyResult.isActive
				? {
						from: recencyResult.filters.find((f) => f.op === 'gte')?.value,
						to: recencyResult.filters.find((f) => f.op === 'lte')?.value,
					}
				: undefined,
			filtersJsonUsed: Boolean(params.filtersJson),
			combinedStrategy: params.filtersJson
				? 'filtersJson+recency'
				: params.filter_logic === 'or' && filters.length >= 2
					? recencyResult.filters.length > 0
						? 'or-group+recency'
						: 'or-group'
					: 'flat-and-recency',
			recencyActive: recencyResult.isActive,
			recencyNote: recencyResult.note,
		},
	});

	const allFilterCount =
		filters.length + recencyResult.filters.length + (params.filtersJson ? 1 : 0);
	if (normalisedOperation === 'get' && entityId === '') {
		return attachCorrelation(
			JSON.stringify(
				allFilterCount > 0
					? wrapError(
							resource,
							'get',
							ERROR_TYPES.INVALID_OPERATION,
							'operation "get" requires a numeric entity ID. Filters and recency parameters are not valid for "get".',
							`Use operation 'getMany' with the same filters to retrieve matching ${resource} records.`,
						)
					: formatIdError(resource, 'get'),
			),
			correlationId,
		);
	}
	const effectiveOperation = normalisedOperation;
	// When offset is used, we need offset+limit records from the API then slice client-side.
	// Cap at MAX_QUERY_LIMIT to stay within API bounds; warn if offset exceeds this.
	const offsetExceedsApiCap = effectiveOffset > 0 && effectiveOffset >= MAX_QUERY_LIMIT;
	const supportsOffsetPagination = ['getMany', 'getPosted', 'getUnposted'].includes(
		effectiveOperation,
	);
	const queryLimit =
		recencyResult.isActive && !effectiveReturnAll
			? RECENCY_OVER_REQUEST_LIMIT
			: effectiveOffset > 0 && supportsOffsetPagination
				? Math.min(effectiveOffset + effectiveLimit, MAX_QUERY_LIMIT)
				: effectiveReturnAll
					? undefined
					: effectiveLimit;
	traceFilterBuild({
		phase: 'pagination-plan',
		resource,
		operation: effectiveOperation,
		correlationId,
		summary: {
			effectiveLimit,
			effectiveOffset,
			queryLimit,
			returnAll: effectiveReturnAll,
			recencyActive: recencyResult.isActive,
			offsetIgnoredDueToRecency: recencyResult.isActive && effectiveOffset > 0,
			offsetExceedsApiCap,
			outputMode: params.outputMode ?? 'idsAndLabels',
			selectedFields: selectedColumns.length > 0 ? selectedColumns : undefined,
		},
	});

	if (supportsOffsetPagination && offsetExceedsApiCap && !effectiveReturnAll) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					`Offset ${effectiveOffset} exceeds the maximum queryable range of ${MAX_QUERY_LIMIT} records. Pagination via offset is limited to the first ${MAX_QUERY_LIMIT} records.`,
					`Use narrower filters (e.g. date ranges via since/until, or more specific filter_field/filter_value) to reduce the result set, then paginate within the narrowed results.`,
				),
			),
			correlationId,
		);
	}

	if (unresolvedIdLikeFilters.length > 0) {
		const unresolvedSummary = unresolvedIdLikeFilterDetails
			.map(
				(detail) =>
					`${detail.field}=[${detail.unresolvedElements.map((value) => `'${String(value)}'`).join(', ')}]`,
			)
			.join(', ');
		const hasPendingCandidates = filterPendingConfirmations.length > 0;
		const pendingSummary = filterPendingConfirmations.map((entry) => {
			const uniqueIds = Array.from(
				new Set(entry.candidates.map((candidate) => String(candidate.id))),
			);
			return {
				field: entry.field,
				candidateCount: uniqueIds.length,
				ids: uniqueIds,
			};
		});
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					`One or more ID-like filters are unresolved and still non-numeric: ${unresolvedSummary}.`,
					hasPendingCandidates
						? `Candidates were found during resolution. Review pendingConfirmations from this response, choose the correct numeric ID, then retry autotask_${resource} with numeric ID filter values.`
						: `Use autotask_${resource} with operation 'getMany' to resolve names to numeric IDs, then retry autotask_${resource} with numeric ID filter values.`,
					{
						unresolvedFilters: unresolvedIdLikeFilters,
						unresolvedFilterDetails: unresolvedIdLikeFilterDetails,
						...(hasPendingCandidates
							? {
									pendingConfirmations: filterPendingConfirmations,
									pendingSummary,
								}
							: {}),
					},
				),
			),
			correlationId,
		);
	}

	const idValidation = validateEntityId(entityId, resource, effectiveOperation);
	if (!idValidation.valid) {
		return attachCorrelation(JSON.stringify(idValidation.error), correlationId);
	}

	const contractViolations = validateOperationContract(
		resource,
		effectiveOperation,
		params as Record<string, unknown>,
	);
	if (contractViolations.length > 0) {
		const message = contractViolations.map((violation) => violation.message).join(' ');
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					message,
					buildContractViolationNextAction(resource, effectiveOperation, contractViolations),
				),
			),
			correlationId,
		);
	}

	// Pre-flight: filter cross-validation (list operations)
	const isListOperation = ['getMany', 'count', 'getPosted', 'getUnposted', 'getByAge', 'searchByKeyword', 'getByCompanyAndStatus', 'getUnassigned', 'getBySLAStatus'].includes(effectiveOperation);
	if (isListOperation) {
		const p = params as Record<string, unknown>;
		const hasFiltersJson = hasProvidedValue(p.filtersJson);
		const hasFlatFilter1 =
			hasProvidedValue(p.filter_field) ||
			hasProvidedValue(p.filter_op) ||
			hasProvidedValue(p.filter_value);
		const hasFlatFilter2 =
			hasProvidedValue(p.filter_field_2) ||
			hasProvidedValue(p.filter_op_2) ||
			hasProvidedValue(p.filter_value_2);

		const filterErrors: string[] = [];

		if (hasFiltersJson && (hasFlatFilter1 || hasFlatFilter2)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow mixing 'filtersJson' with flat filter fields.`);
		}
		const isNullCheckOp1 = ['exist', 'notexist'].includes(String(p.filter_op ?? '').toLowerCase());
		if (hasProvidedValue(p.filter_field) && !hasProvidedValue(p.filter_value) && !isNullCheckOp1) {
			filterErrors.push(`Operation '${effectiveOperation}' requires 'filter_value' when 'filter_field' is provided (not needed when filter_op is 'exist' or 'notExist').`);
		}
		if (!hasProvidedValue(p.filter_field) && hasProvidedValue(p.filter_value)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow 'filter_value' without 'filter_field'.`);
		}
		if (hasFlatFilter2) {
			const hasFilter2Field = hasProvidedValue(p.filter_field_2);
			const hasFilter2Value = hasProvidedValue(p.filter_value_2);
			const isNullCheckOp2 = ['exist', 'notexist'].includes(String(p.filter_op_2 ?? '').toLowerCase());
			if (!hasFilter2Field || (!hasFilter2Value && !isNullCheckOp2)) {
				filterErrors.push(
					`Operation '${effectiveOperation}' requires 'filter_field_2' and 'filter_value_2' when using a second filter (filter_value_2 not needed when filter_op_2 is 'exist' or 'notExist').`,
				);
			}
			if (!hasFlatFilter1) {
				filterErrors.push(`Operation '${effectiveOperation}' does not allow a second filter without the first filter.`);
			}
		}
		if (hasProvidedValue(p.filter_logic) && !(hasFlatFilter1 && hasFlatFilter2)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow 'filter_logic' unless both filter pairs are present.`);
		}
		if (hasProvidedValue(p.recency) && (hasProvidedValue(p.since) || hasProvidedValue(p.until))) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow 'recency' together with 'since' or 'until'.`);
		}
		if (hasProvidedValue(p.until) && !hasProvidedValue(p.since) && !hasProvidedValue(p.recency)) {
			filterErrors.push(`Operation '${effectiveOperation}' requires 'since' or 'recency' when 'until' is provided.`);
		}

		if (filterErrors.length > 0) {
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						effectiveOperation,
						ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
						filterErrors.join(' '),
						`Call autotask_${resource} with operation '${effectiveOperation}' and fix the filter parameter issues: ${filterErrors.join(' ')}`,
					),
				),
				correlationId,
			);
		}

		// Pre-flight: validate filter_field names against read field metadata.
		// Runs after alias resolution — aliased fields (e.g. name→companyName) pass cleanly here.
		// Converts silent 0-result API responses into actionable errors with field suggestions.
		if (readFields.length > 0 && !hasFiltersJson) {
			const readFieldIds = new Set(readFields.map((f) => f.id.toLowerCase()));
			const invalidFieldErrors: string[] = [];
			for (const f of filters) {
				if (!f.udf && !readFieldIds.has(f.field.toLowerCase())) {
					const displayName = f.aliasedFrom
						? `'${f.aliasedFrom}' (mapped to '${f.field}')`
						: `'${f.field}'`;
					const suggestions = readFields
						.map((rf) => rf.id)
						.filter((id) => {
							const ll = id.toLowerCase();
							const fl = f.field.toLowerCase();
							return ll.startsWith(fl.slice(0, 4)) || fl.startsWith(ll.slice(0, 4));
						})
						.slice(0, 4);
					invalidFieldErrors.push(
						`${displayName} is not a valid filter field for ${resource}.` +
						(suggestions.length > 0
							? ` Did you mean: ${suggestions.join(', ')}?`
							: ` Call autotask_${resource} with operation 'describeFields' to see valid fields.`),
					);
				}
			}
			if (invalidFieldErrors.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							effectiveOperation,
							ERROR_TYPES.INVALID_FIELDS,
							invalidFieldErrors.join(' '),
							`Call autotask_${resource} with operation 'describeFields' with mode 'read' to discover valid field names, then retry with corrected filter_field.`,
							undefined,
							['describeFields'],
						),
					),
					correlationId,
				);
			}
		}
	}

	// Pre-flight: reject rejectReason (when rejectReasonPolicy is mandatory)
	if (
		effectiveOperation === 'reject' &&
		(params as Record<string, unknown>).rejectReasonPolicy === 'mandatory' &&
		!hasProvidedValue((params as Record<string, unknown>).rejectReason)
	) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					"Operation 'reject' requires 'rejectReason' when rejectReasonPolicy is 'mandatory'.",
					`Call autotask_${resource} with operation 'reject' and include 'rejectReason'.`,
				),
			),
			correlationId,
		);
	}

	if (
		['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain', 'searchByIdentity'].includes(
			effectiveOperation,
		)
	) {
		const udfFilters = filters.filter((filter) => filter.udf);
		if (udfFilters.length > 1) {
			return attachCorrelation(
				JSON.stringify(
					formatFilterConstraintError(
						resource,
						effectiveOperation,
						`Only one UDF filter is supported per query for ${resource}.${effectiveOperation}.`,
						`Retry with a single UDF filter, or use autotask_${resource} with operation 'describeFields' to use standard fields where possible.`,
					),
				),
				correlationId,
			);
		}
		const readValidation = validateReadFields(
			selectedColumns,
			readFields,
			resource,
			effectiveOperation,
		);
		if (!readValidation.valid) {
			return attachCorrelation(JSON.stringify(readValidation.error), correlationId);
		}
	}

	if (['create', 'update', 'createIfNotExists'].includes(effectiveOperation)) {
		const writeValidation = validateWriteFields(
			fieldValues,
			writeFields,
			resource,
			effectiveOperation,
		);
		if (!writeValidation.valid) {
			return attachCorrelation(JSON.stringify(writeValidation.error), correlationId);
		}
	}

	// Resolve human-readable labels to IDs for picklist and reference fields on write ops.
	// This allows the LLM to pass names (e.g. "Will Spence") instead of numeric IDs.
	let labelResolutions: LabelResolution[] = [];
	let labelWarnings: string[] = [];
	let labelPendingConfirmations: PendingLabelConfirmation[] = [];
	if (
		['create', 'update', 'createIfNotExists'].includes(effectiveOperation) &&
		Object.keys(fieldValues).length > 0
	) {
		try {
			const resolution = await resolveLabelsToIds(
				context,
				resource,
				fieldValues as IDataObject,
				params as IDataObject,
			);
			// Replace fieldValues entries with resolved IDs in-place
			for (const [key, value] of Object.entries(resolution.values)) {
				fieldValues[key] = value;
			}
			labelResolutions = resolution.resolutions;
			labelWarnings = resolution.warnings;
			labelPendingConfirmations = resolution.pendingConfirmations;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			labelWarnings.push(`Label resolution failed: ${msg}.`);
		}
	}

	// Resolve impersonationResourceId name/email → numeric ID for write operations only.
	// Gated to write ops to avoid unnecessary Resource entity list fetch on reads.
	const isWriteOperation = [
		'create',
		'createIfNotExists',
		'update',
		'moveConfigurationItem',
		'moveToCompany',
		'transferOwnership',
		'approve',
		'reject',
		'delete',
	].includes(effectiveOperation);
	let resolvedImpersonationId: number | undefined;
	let labelImpersonationFailed = false;
	const rawImpersonation = params.impersonationResourceId;
	if (
		isWriteOperation &&
		rawImpersonation !== undefined &&
		rawImpersonation !== null &&
		rawImpersonation !== ''
	) {
		const impersonationValue =
			typeof rawImpersonation === 'string' ? rawImpersonation.trim() : rawImpersonation;
		const isNumericId =
			typeof impersonationValue === 'number' ||
			(typeof impersonationValue === 'string' &&
				/^\d+$/.test(impersonationValue) &&
				String(parseInt(impersonationValue, 10)) === impersonationValue);

		if (isNumericId) {
			resolvedImpersonationId =
				typeof impersonationValue === 'number'
					? impersonationValue
					: parseInt(impersonationValue, 10);
		} else if (typeof impersonationValue === 'string') {
			// Resolve name or email to resource ID
			try {
				const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
				const helper = new EntityValueHelper(
					context as unknown as import('n8n-workflow').ILoadOptionsFunctions,
					'Resource',
				);
				const candidates = await helper.getValues(true);
				const label = impersonationValue.toLowerCase();

				// Try exact name match first
				let matchedId: number | undefined;
				for (const entity of candidates) {
					const entityObj = entity as unknown as IDataObject;
					const display = helper.getEntityDisplayName(entityObj);
					if (display && display.toLowerCase() === label) {
						matchedId = entityObj.id as number;
						break;
					}
					// Also check email fields (must check each independently — ?? stops at first non-null)
					const emailFields = [entityObj.email, entityObj.email2, entityObj.email3] as (
						| string
						| undefined
					)[];
					if (emailFields.some((e) => e && e.toLowerCase() === label)) {
						matchedId = entityObj.id as number;
						break;
					}
				}

				if (matchedId !== undefined) {
					resolvedImpersonationId = matchedId;
					labelResolutions.push({
						field: 'impersonationResourceId',
						from: impersonationValue,
						to: matchedId,
						method: 'reference',
					});
				} else {
					labelImpersonationFailed = true;
					labelWarnings.push(
						`Could not resolve impersonation resource '${impersonationValue}' to a resource ID. Provide a numeric ID instead.`,
					);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				labelImpersonationFailed = true;
				labelWarnings.push(
					`[INFRASTRUCTURE] Impersonation resource resolution failed: ${msg}. Provide a numeric ID instead.`,
				);
			}
		}
	}
	traceLabelResolution({
		phase: 'write-resolution',
		resource,
		operation: effectiveOperation,
		correlationId,
		summary: {
			attempted: isWriteOperation && Object.keys(fieldValues).length > 0,
			...summariseResolutionState(labelResolutions, labelWarnings, labelPendingConfirmations),
			impersonationResolved: resolvedImpersonationId !== undefined,
			impersonationFailed: labelImpersonationFailed,
			...(AI_TOOL_DEBUG_VERBOSE ? { fieldValuesPreview: redactForVerbose(fieldValues) } : {}),
		},
	});

	// Auto-inject roleID for timeEntry.createIfNotExists when not provided.
	// Uses the resource's defaultServiceDeskRoleID as a sensible default so the
	// LLM doesn't need to call getAvailableRoles for routine time-logging.
	if (
		resource === 'timeEntry' &&
		effectiveOperation === 'createIfNotExists' &&
		!fieldValues.roleID &&
		fieldValues.resourceID
	) {
		const resId = Number(fieldValues.resourceID);
		if (resId > 0) {
			try {
				const resResponse = await autotaskApiRequest.call(
					context, 'GET', `Resources/${resId}`,
				) as { item?: Record<string, unknown> };
				const defaultRoleId = resResponse?.item?.defaultServiceDeskRoleID;
				if (typeof defaultRoleId === 'number' && defaultRoleId > 0) {
					fieldValues.roleID = defaultRoleId;
					labelResolutions.push({
						field: 'roleID',
						from: 'auto:resource.defaultServiceDeskRoleID',
						to: defaultRoleId,
						method: 'reference',
					});
				}
			} catch {
				// Non-fatal — LLM will get API error and can call getAvailableRoles
			}
		}
	}

	// Pre-execution write guard: block if any resolution failure condition exists.
	if (isWriteOperation) {
		const blocker = buildWriteResolutionBlocker(
			resource,
			effectiveOperation,
			labelPendingConfirmations,
			labelWarnings,
			labelImpersonationFailed,
		);
		if (blocker !== null) return attachCorrelation(blocker, correlationId);
	}
	context.getNodeParameter = ((
		name: string,
		index: number,
		fallbackValue?: unknown,
		_options?: IGetNodeParameterOptions,
	): unknown => {
		switch (name) {
			case 'resource':
				return resource;
			case 'operation':
				return effectiveOperation;
			case 'id':
				return entityId;
			case 'targetOperation':
				return `${resource}.${effectiveOperation}`;
			case 'entityId':
				return entityId;
			case 'requestData': {
				const data: Record<string, unknown> =
					['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) &&
					combinedFilters.length > 0
						? { filter: combinedFilters }
						: Object.keys(fieldValues).length > 0
							? fieldValues
							: {};
				const identifierPairConfig = getIdentifierPairConfig(resource, effectiveOperation);
				if (identifierPairConfig) {
					if (params.id !== undefined) {
						data.id = params.id;
					}
					const altField = identifierPairConfig.altIdField;
					const altVal = (params as Record<string, unknown>)[altField];
					if (typeof altVal === 'string' && altVal.trim() !== '') {
						data[altField] = altVal.trim();
					}
				}
				if (effectiveOperation === 'slaHealthCheck' && selectedSlaTicketColumns.length > 0) {
					data.slaTicketFields = selectedSlaTicketColumns;
				}
				// Always apply bounded query limits for list/count style operations.
				// Note: offset is applied client-side only (slice after fetch), not sent to API.
				if (
					['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) &&
					queryLimit !== undefined
				) {
					data.limit = queryLimit;
				}
				if (['searchByDomain', 'searchByIdentity'].includes(effectiveOperation)) {
					data.limit = effectiveLimit;
				}
				return JSON.stringify(data);
			}
			case 'fieldsToMap':
				if (
					['create', 'update'].includes(effectiveOperation) &&
					Object.keys(fieldValues).length > 0
				) {
					return { mappingMode: 'defineBelow', value: fieldValues };
				}
				if (
					['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) &&
					combinedFilters.length > 0
				) {
					const value: Record<string, unknown> = {};
					// Only extract field/value from flat filter objects (skip nested OR/AND groups)
					for (const f of combinedFilters) {
						if (f.field !== undefined) {
							value[f.field] = f.value;
						}
					}
					return { value };
				}
				return fallbackValue ?? { value: {} };
			case 'filtersFromTool':
				return ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation) &&
					combinedFilters.length > 0
					? combinedFilters
					: undefined;
			case 'returnAll':
				return effectiveReturnAll;
			case 'maxRecords':
				return effectiveReturnAll || queryLimit === undefined
					? undefined // executeScopedQuery handles full pagination internally; MaxRecords is ignored
					: queryLimit;
			case 'bodyJson':
				if (
					['create', 'update'].includes(effectiveOperation) &&
					Object.keys(fieldValues).length > 0
				) {
					return JSON.stringify(fieldValues);
				}
				return fallbackValue ?? '{}';
			// Label enrichment and UDF flattening -- default to idsAndLabels; caller may override to rawIds.
			// addPicklistLabels and addReferenceLabels remain hardcoded true even when outputMode='rawIds':
			// processOutputMode() reads outputMode first and short-circuits label enrichment before these
			// flags are consulted, so they have no effect in rawIds mode. Keeping them true avoids
			// sending a narrower IncludeFields request that would omit label columns needed if the
			// caller later switches back to idsAndLabels without a new API call.
			case 'outputMode':
				return (params.outputMode as string | undefined) ?? 'idsAndLabels';
			case 'addPicklistLabels':
				return true;
			case 'addReferenceLabels':
				return true;
			case 'flattenUdfs':
				return true;
			case 'ticketIdentifierType': {
				const ipc = getIdentifierPairConfig(resource, effectiveOperation);
				if (ipc) {
					const altVal = params[ipc.altIdField as keyof typeof params];
					return typeof altVal === 'string' && altVal.trim() !== '' ? ipc.altIdField : 'id';
				}
				return fallbackValue;
			}
			case 'ticketNumber': {
				const ipc = getIdentifierPairConfig(resource, effectiveOperation);
				if (ipc && ipc.altIdField === 'ticketNumber') {
					return typeof params.ticketNumber === 'string'
						? params.ticketNumber.trim()
						: fallbackValue;
				}
				return fallbackValue;
			}
			case 'includeRaw':
				if (effectiveOperation === 'summary') {
					return typeof params.includeRaw === 'boolean' ? params.includeRaw : false;
				}
				return fallbackValue;
			case 'summaryTextLimit':
				if (effectiveOperation === 'summary') {
					return typeof params.summaryTextLimit === 'number' ? params.summaryTextLimit : 500;
				}
				return fallbackValue;
			case 'includeChildCounts':
				if (effectiveOperation === 'summary') {
					return typeof params.includeChildCounts === 'boolean' ? params.includeChildCounts : false;
				}
				return fallbackValue;
			case 'slaTicketFields':
				if (effectiveOperation === 'slaHealthCheck') {
					return selectedSlaTicketColumns.length > 0 ? selectedSlaTicketColumns : [];
				}
				return fallbackValue;
			// Column selection
			case 'selectColumns':
				return selectedColumns.length > 0 ? selectedColumns : [];
			case 'selectColumnsJson':
				return selectedColumns.length > 0 ? JSON.stringify(selectedColumns) : '[]';
			case 'allowWriteOperations':
				return originalGetNodeParameter('allowWriteOperations', index, false);
			case 'impersonationResourceId':
				if (resolvedImpersonationId !== undefined) {
					return resolvedImpersonationId;
				}
				// If rawImpersonation was a non-numeric string that failed resolution,
				// return fallbackValue so getOptionalImpersonationResourceId treats it as absent.
				// The warning is already in labelWarnings.
				if (
					typeof rawImpersonation === 'string' &&
					rawImpersonation.trim() !== '' &&
					!/^\d+$/.test(rawImpersonation.trim())
				) {
					return fallbackValue;
				}
				return rawImpersonation ?? fallbackValue;
			case 'allowedResources':
				// The AI tools path validates resource+operations in supplyData() at tool
				// construction time. The downstream executor's allowedResources check is
				// redundant — the AI tool already ensures only the configured resource's
				// operations reach executeAiTool(). Empty array disables the allowlist check.
				return '[]';
			default:
				if (Object.prototype.hasOwnProperty.call(params, name)) {
					return params[name as keyof ToolExecutorParams];
				}
				// Return the caller's fallback rather than reading from the AI tool node's
				// own n8n config. If a resource executor adds a new getNodeParameter key
				// not listed above, it will get fallbackValue (safe) and the missing case
				// will be discoverable — not silently use a wrong node-level config value.
				if (process.env.N8N_AI_TOOL_STRICT_PARAMS === '1') {
					console.warn(
						`[AutotaskAiTools] Unmapped getNodeParameter key "${name}" ` +
							`for ${resource}.${effectiveOperation} — returning fallbackValue. ` +
							`Add an explicit case to the override switch in tool-executor.ts.`,
					);
				}
				return fallbackValue;
		}
	}) as typeof context.getNodeParameter;

	try {
		// Compound operation short-circuit: createIfNotExists bypasses the standard executor
		if (effectiveOperation === 'createIfNotExists') {
			// createFields comes from fieldValues (already validated + label-resolved above)
			// Convert date fields from user timezone to UTC before passing to compound helpers,
			// which bypass CreateOperation.execute() and therefore convertDatesToUTC.
			const createFields: Record<string, unknown> = (await convertDatesToUTC(
				{ ...fieldValues } as IDataObject,
				resource,
				context,
				'createIfNotExists',
			)) as Record<string, unknown>;
			const registryEntry = COMPOUND_REGISTRY[resource];
			if (!registryEntry) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'createIfNotExists',
							ERROR_TYPES.INVALID_OPERATION,
							`createIfNotExists is not implemented for resource '${resource}'.`,
							`Use autotask_${resource} with operation 'create' instead.`,
						),
					),
					correlationId,
				);
			}
			const dedupFields = (params.dedupFields as string[]) ?? registryEntry.defaultDedupFields;
			const errorOnDuplicate = params.errorOnDuplicate === true;
			const updateFields = (params.updateFields as string[] | undefined) ?? [];

			const compoundOptions = {
				createFields,
				dedupFields,
				errorOnDuplicate,
				updateFields,
				impersonationResourceId: resolvedImpersonationId,
				proceedWithoutImpersonationIfDenied: params.proceedWithoutImpersonationIfDenied !== false,
			};

			const handler = await registryEntry.getHandler();
			 
			const compoundResult: any = await handler(context, 0, compoundOptions);

			if (compoundResult) {
				// Reclassify not-found outcomes as errors
				if (COMPOUND_PARENT_NOT_FOUND_OUTCOMES.has(compoundResult.outcome)) {
					const parentRef =
						compoundResult.parentLookupValue ??
						compoundResult.companyID ??
						compoundResult.ticketID ??
						'unknown';
					return attachCorrelation(
						JSON.stringify(
							wrapError(
								resource,
								'createIfNotExists',
								ERROR_TYPES.ENTITY_NOT_FOUND,
								`Parent entity not found: ${parentRef}`,
								`Verify the parent entity identifier and retry.`,
								{ outcome: compoundResult.outcome },
							),
						),
						correlationId,
					);
				}

				// Merge compound warnings with label resolution warnings
				const rawCompoundWarnings: string[] = Array.isArray(compoundResult.warnings)
					? compoundResult.warnings
					: [];
				const allWarnings = [...rawCompoundWarnings, ...labelWarnings];

				const entityId = buildCompoundEntityId(resource, compoundResult);
				const existingEntityId = buildCompoundExistingId(resource, compoundResult);
				const compoundContext = buildCompoundContext(resource, compoundResult);

				const compoundData: Record<string, unknown> = {
					outcome: compoundResult.outcome,
				};
				if (entityId !== undefined) compoundData.id = entityId;
				if (existingEntityId !== undefined) compoundData.existingId = existingEntityId;
				if (compoundResult.matchedDedupFields !== undefined)
					compoundData.matchedDedupFields = compoundResult.matchedDedupFields;
				if (compoundResult.fieldsUpdated !== undefined)
					compoundData.fieldsUpdated = compoundResult.fieldsUpdated;
				if (compoundResult.fieldsCompared !== undefined)
					compoundData.fieldsCompared = compoundResult.fieldsCompared;
				if (compoundContext !== undefined) compoundData.context = compoundContext;

				const compoundJson = JSON.stringify(
					buildCompoundResponse(
						resource,
						'createIfNotExists',
						compoundData as Parameters<typeof buildCompoundResponse>[2],
						{
							resolutions: labelResolutions,
							resolutionWarnings: allWarnings,
							pendingConfirmations: labelPendingConfirmations,
						},
					),
				);
				const enrichedCompoundJson = await enrichResponseJson(compoundJson, context);
				return attachCorrelation(enrichedCompoundJson, correlationId);
			}
		}

		// Convenience-ops resource gate — fail fast for unsupported resources.
		const CONVENIENCE_OPS_SET = new Set([
			'getByCompanyAndStatus',
			'getUnassigned',
			'getBySLAStatus',
			'getFullDetail',
			'countByPeriod',
			'getByAge',
		]);
		if (CONVENIENCE_OPS_SET.has(effectiveOperation)) {
			const cfgCheck = getConvenienceConfig(resource);
			if (!cfgCheck) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							effectiveOperation,
							ERROR_TYPES.INVALID_OPERATION,
							`Operation '${effectiveOperation}' is not supported for resource '${resource}'.`,
							`This convenience operation is only available on supported resources. Use autotask_${resource} with operation 'getMany' instead.`,
						),
					),
					correlationId,
				);
			}
			if (effectiveOperation === 'getBySLAStatus' && !cfgCheck.supportsSLA) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							effectiveOperation,
							ERROR_TYPES.INVALID_OPERATION,
							`Operation 'getBySLAStatus' is only supported for tickets — '${resource}' has no SLA concept.`,
							`Use autotask_${resource} with operation 'getMany' and date filters to find ${resource} records by status or age.`,
						),
					),
					correlationId,
				);
			}
		}

		// Short-circuit: getByCompanyAndStatus
		if (effectiveOperation === 'getByCompanyAndStatus') {
			const cfg = getConvenienceConfig(resource)!;
			const companyRaw = params.company;
			if (companyRaw === undefined || companyRaw === null || String(companyRaw).trim() === '') {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getByCompanyAndStatus',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							"'company' is required for getByCompanyAndStatus.",
							`Call autotask_${resource} with operation 'getByCompanyAndStatus' and provide 'company' as a name or numeric ID.`,
						),
					),
					correlationId,
				);
			}

			// Build synthetic filters: company is required; status and priority are optional.
			// resolveAndClassifyFilters resolves string values to numeric IDs in-place.
			const syntheticFilters: ToolFilter[] = [];
			if (cfg.companyFilterStrategy === 'direct') {
				syntheticFilters.push({ field: 'companyID', op: 'eq', value: companyRaw as string | number });
			}
			if (params.status !== undefined && params.status !== null) {
				syntheticFilters.push({ field: 'status', op: 'eq', value: params.status as string | number });
			}
			if (cfg.hasPriority && params.priority !== undefined && params.priority !== null) {
				syntheticFilters.push({ field: 'priority', op: 'eq', value: params.priority as string | number });
			}

			const {
				resolutions: specialResolutions,
				warnings: specialWarningsRaw,
				pendingConfirmations: specialPending,
				unresolvedIdLikeFilters: specialUnresolved,
			} = await resolveAndClassifyFilters(context, resource, syntheticFilters, readFields, params as IDataObject);
			const specialWarnings: string[] = [...specialWarningsRaw];

			if (specialUnresolved.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getByCompanyAndStatus',
							ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Could not resolve: ${specialUnresolved.map((f) => `${f.field}='${String(f.value)}'`).join(', ')}`,
							`Verify the company name is exact, or use a numeric companyID. For status${cfg.hasPriority ? '/priority' : ''}, call autotask_${resource} with operation 'listPicklistValues' and fieldId='status'${cfg.hasPriority ? " or 'priority'" : ''}.`,
							{ pendingConfirmations: specialPending.length > 0 ? specialPending : undefined },
						),
					),
					correlationId,
				);
			}

			// viaProject company filter resolution (e.g. task → projects → projectID-IN)
			if (cfg.companyFilterStrategy === 'viaProject' && companyRaw !== undefined && companyRaw !== null) {
				const r = await resolveCompanyToProjectIdFilter(context, companyRaw as string | number, 'getByCompanyAndStatus', resource);
				if ('error' in r) return attachCorrelation(JSON.stringify(r.error), correlationId);
				if ('empty' in r) {
					return attachCorrelation(
						JSON.stringify(
							buildListResponse(resource, 'getByCompanyAndStatus', [], {
								hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT,
							}, {
								resolutionWarnings: [`No projects found for company '${String(companyRaw)}'.`],
							}),
						),
						correlationId,
					);
				}
				syntheticFilters.unshift(r.filter);
				if (r.warning) specialWarnings.push(r.warning);
			}

			// After resolveAndClassifyFilters, syntheticFilters values are resolved in-place.
			// Append recency filters (already built above) to apply date-range constraints.
			const apiFilters: ToolFilter[] = [...syntheticFilters, ...(recencyResult.filters as ToolFilter[])];

			const queryLimitForOp = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit) : DEFAULT_QUERY_LIMIT);
			const requestBody: IDataObject = { filter: apiFilters as unknown as IDataObject[] };
			if (queryLimitForOp !== undefined) {
				requestBody.MaxRecords = queryLimitForOp;
			}

			const gbcasResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, requestBody) as { items?: IAutotaskEntity[] };
			const gbcasItems = Array.isArray(gbcasResponse.items) ? gbcasResponse.items as Record<string, unknown>[] : [];

			const allGbcasWarnings = [...specialWarnings, ...labelWarnings];
			const allGbcasResolutions = [...specialResolutions, ...labelResolutions];

			const gbcasListJson = JSON.stringify(
				buildListResponse(resource, 'getByCompanyAndStatus', gbcasItems, {
					hasMore: queryLimitForOp !== undefined && gbcasItems.length >= queryLimitForOp,
					serverCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
					clientCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
				}, {
					resolutions: allGbcasResolutions.length > 0 ? allGbcasResolutions : undefined,
					resolutionWarnings: allGbcasWarnings.length > 0 ? allGbcasWarnings : undefined,
					pendingConfirmations: specialPending.length > 0 ? specialPending : undefined,
				}),
			);
			const enrichedGbcasJson = await enrichResponseJson(gbcasListJson, context);
			return attachCorrelation(enrichedGbcasJson, correlationId);
		}

		// Short-circuit: getUnassigned
		if (effectiveOperation === 'getUnassigned') {
			const cfg = getConvenienceConfig(resource)!;
			// Hardcoded base filters: unassigned + not complete/cancelled
			const unassignedFilters: ToolFilter[] = [
				{ field: cfg.assignedField, op: 'notExist' },
				{ field: 'status', op: 'notIn', value: cfg.terminalStatusIds },
			];

			// Optional: company and priority filters (resolve name→ID)
			const optionalFilters: ToolFilter[] = [];
			if (cfg.companyFilterStrategy === 'direct' && params.company !== undefined && params.company !== null) {
				optionalFilters.push({ field: 'companyID', op: 'eq', value: params.company as string | number });
			}
			if (cfg.hasPriority && params.priority !== undefined && params.priority !== null) {
				optionalFilters.push({ field: 'priority', op: 'eq', value: params.priority as string | number });
			}

			let specialUnresolved: ToolFilter[] = [];
			let specialResolutions: any[] = [];
			let specialWarnings: string[] = [];
			let specialPending: any[] = [];

			if (optionalFilters.length > 0) {
				const resolved = await resolveAndClassifyFilters(context, resource, optionalFilters, readFields, params as IDataObject);
				specialUnresolved = resolved.unresolvedIdLikeFilters;
				specialResolutions = resolved.resolutions;
				specialWarnings = resolved.warnings;
				specialPending = resolved.pendingConfirmations;
			}

			if (specialUnresolved.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getUnassigned',
							ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Could not resolve: ${specialUnresolved.map((f) => `${f.field}='${String(f.value)}'`).join(', ')}`,
							`Verify the company name is exact or use a numeric companyID. For priority, call autotask_${resource} with operation 'listPicklistValues' and fieldId='priority'.`,
							{ pendingConfirmations: specialPending.length > 0 ? specialPending : undefined },
						),
					),
					correlationId,
				);
			}

			// viaProject company filter resolution (e.g. task → projects → projectID-IN)
			if (cfg.companyFilterStrategy === 'viaProject' && params.company !== undefined && params.company !== null) {
				const r = await resolveCompanyToProjectIdFilter(context, params.company as string | number, 'getUnassigned', resource);
				if ('error' in r) return attachCorrelation(JSON.stringify(r.error), correlationId);
				if ('empty' in r) {
					return attachCorrelation(
						JSON.stringify(
							buildListResponse(resource, 'getUnassigned', [], {
								hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT,
							}, {
								resolutionWarnings: [`No projects found for company '${String(params.company)}'.`],
							}),
						),
						correlationId,
					);
				}
				optionalFilters.unshift(r.filter);
				if (r.warning) specialWarnings.push(r.warning);
			}

			const apiFilters: ToolFilter[] = [...unassignedFilters, ...optionalFilters, ...(recencyResult.filters as ToolFilter[])];
			const queryLimitForOp = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit) : DEFAULT_QUERY_LIMIT);
			const requestBody: IDataObject = { filter: apiFilters as unknown as IDataObject[] };
			if (queryLimitForOp !== undefined) {
				requestBody.MaxRecords = queryLimitForOp;
			}

			const unassignedResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, requestBody) as { items?: IAutotaskEntity[] };
			const unassignedItems = Array.isArray(unassignedResponse.items) ? unassignedResponse.items as Record<string, unknown>[] : [];

			const allUnassignedWarnings = [...specialWarnings, ...labelWarnings];
			const allUnassignedResolutions = [...specialResolutions, ...labelResolutions];

			const unassignedListJson = JSON.stringify(
				buildListResponse(resource, 'getUnassigned', unassignedItems, {
					hasMore: queryLimitForOp !== undefined && unassignedItems.length >= queryLimitForOp,
					serverCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
					clientCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
				}, {
					resolutions: allUnassignedResolutions.length > 0 ? allUnassignedResolutions : undefined,
					resolutionWarnings: allUnassignedWarnings.length > 0 ? allUnassignedWarnings : undefined,
					pendingConfirmations: specialPending.length > 0 ? specialPending : undefined,
				}),
			);
			const enrichedUnassignedJson = await enrichResponseJson(unassignedListJson, context);
			return attachCorrelation(enrichedUnassignedJson, correlationId);
		}

		// Short-circuit: getBySLAStatus
		if (effectiveOperation === 'getBySLAStatus') {
			const cfg = getConvenienceConfig(resource)!;
			const slaStatusParam = params.slaStatus as string | undefined;
			if (!slaStatusParam || !['breached', 'at_risk', 'compliant'].includes(slaStatusParam)) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getBySLAStatus',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							"'slaStatus' is required: 'breached', 'at_risk', or 'compliant'.",
							`Call autotask_${resource} with operation 'getBySLAStatus' and slaStatus set to one of: breached, at_risk, compliant.`,
						),
					),
					correlationId,
				);
			}

			// Build SLA filters based on slaStatus
			let slaFilters: any[];
			if (slaStatusParam === 'breached') {
				slaFilters = [{ field: 'serviceLevelAgreementHasBeenMet', op: 'eq', value: false }];
			} else if (slaStatusParam === 'compliant') {
				slaFilters = [{ field: 'serviceLevelAgreementHasBeenMet', op: 'eq', value: true }];
			} else {
				// at_risk: within atRiskWindowHours hours of resolvedDueDateTime, not yet breached
				const windowHours = typeof params.atRiskWindowHours === 'number' && params.atRiskWindowHours > 0
					? params.atRiskWindowHours
					: 4;
				const now = new Date();
				const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
				slaFilters = [{
					op: 'and',
					items: [
						{ field: 'resolvedDueDateTime', op: 'gt', value: now.toISOString() },
						{ field: 'resolvedDueDateTime', op: 'lt', value: windowEnd.toISOString() },
						{ field: 'status', op: 'notIn', value: cfg.terminalStatusIds },
					],
				}];
			}

			// Optional company filter (resolve name→ID)
			const slaOptionalFilters: ToolFilter[] = [];
			if (params.company !== undefined && params.company !== null) {
				slaOptionalFilters.push({ field: 'companyID', op: 'eq', value: params.company as string | number });
			}

			let slaSpecialUnresolved: ToolFilter[] = [];
			let slaSpecialResolutions: any[] = [];
			let slaSpecialWarnings: string[] = [];
			let slaSpecialPending: any[] = [];

			if (slaOptionalFilters.length > 0) {
				const resolved = await resolveAndClassifyFilters(context, resource, slaOptionalFilters, readFields, params as IDataObject);
				slaSpecialUnresolved = resolved.unresolvedIdLikeFilters;
				slaSpecialResolutions = resolved.resolutions;
				slaSpecialWarnings = resolved.warnings;
				slaSpecialPending = resolved.pendingConfirmations;
			}

			if (slaSpecialUnresolved.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getBySLAStatus',
							ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Could not resolve company: '${String(params.company)}'`,
							`Verify the company name is exact or use a numeric companyID.`,
							{ pendingConfirmations: slaSpecialPending.length > 0 ? slaSpecialPending : undefined },
						),
					),
					correlationId,
				);
			}

			const apiSlaFilters: any[] = [...slaFilters, ...slaOptionalFilters, ...(recencyResult.filters as any[])];
			const queryLimitForSla = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit) : DEFAULT_QUERY_LIMIT);
			const slaRequestBody: IDataObject = { filter: apiSlaFilters as IDataObject[] };
			if (queryLimitForSla !== undefined) {
				slaRequestBody.MaxRecords = queryLimitForSla;
			}

			const slaResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, slaRequestBody) as { items?: IAutotaskEntity[] };
			const slaItems = Array.isArray(slaResponse.items) ? slaResponse.items as Record<string, unknown>[] : [];

			const allSlaWarnings = [...slaSpecialWarnings, ...labelWarnings];
			const allSlaResolutions = [...slaSpecialResolutions, ...labelResolutions];

			const slaListJson = JSON.stringify(
				buildListResponse(resource, 'getBySLAStatus', slaItems, {
					hasMore: queryLimitForSla !== undefined && slaItems.length >= queryLimitForSla,
					serverCap: queryLimitForSla ?? MAX_QUERY_LIMIT,
					clientCap: queryLimitForSla ?? MAX_QUERY_LIMIT,
				}, {
					resolutions: allSlaResolutions.length > 0 ? allSlaResolutions : undefined,
					resolutionWarnings: allSlaWarnings.length > 0 ? allSlaWarnings : undefined,
					pendingConfirmations: slaSpecialPending.length > 0 ? slaSpecialPending : undefined,
				}),
			);
			const enrichedSlaJson = await enrichResponseJson(slaListJson, context);
			return attachCorrelation(enrichedSlaJson, correlationId);
		}

		// Short-circuit: getFullDetail
		if (effectiveOperation === 'getFullDetail') {
			const cfg = getConvenienceConfig(resource)!;
			const fdIdPairConfig = getIdentifierPairConfig(resource, 'getFullDetail');
			let fullDetailTicketId: string | undefined;
			if (params.id !== undefined && params.id !== null) {
				fullDetailTicketId = String(params.id);
			} else if (fdIdPairConfig && typeof params.ticketNumber === 'string' && params.ticketNumber.trim()) {
				const tnLookup = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, {
					filter: [{ field: fdIdPairConfig.altIdField, op: 'eq', value: params.ticketNumber.trim() }],
					MaxRecords: 1,
				} as IDataObject) as { items?: IAutotaskEntity[] };
				const tnItems = Array.isArray(tnLookup.items) ? tnLookup.items : [];
				if (tnItems.length === 0) {
					return attachCorrelation(
						JSON.stringify(
							wrapError(
								resource,
								'getFullDetail',
								ERROR_TYPES.ENTITY_NOT_FOUND,
								`Ticket with ${fdIdPairConfig.altIdField} '${params.ticketNumber}' not found.`,
								`Verify the ticket number format (e.g. ${fdIdPairConfig.altIdExample}) and retry autotask_${resource} with operation 'getMany'.`,
							),
						),
						correlationId,
					);
				}
				fullDetailTicketId = String(tnItems[0].id);
			}

			if (!fullDetailTicketId) {
				const missingMsg = fdIdPairConfig
					? `Either 'id' (numeric) or '${fdIdPairConfig.altIdField}' (e.g. ${fdIdPairConfig.altIdExample}) is required for getFullDetail.`
					: `'id' (numeric) is required for getFullDetail.`;
				const missingNext = fdIdPairConfig
					? `Call autotask_${resource} with operation 'getFullDetail' and provide 'id' or '${fdIdPairConfig.altIdField}'.`
					: `Call autotask_${resource} with operation 'getFullDetail' and provide 'id'.`;
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getFullDetail',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							missingMsg,
							missingNext,
						),
					),
					correlationId,
				);
			}

			const resolvedDetailId = fullDetailTicketId;
			const fullDetailResponse = await autotaskApiRequest.call(context, 'GET', cfg.getEndpoint(resolvedDetailId)) as { item?: IAutotaskEntity };
			const rawFullDetailTicket = fullDetailResponse.item;
			if (!rawFullDetailTicket || typeof rawFullDetailTicket !== 'object') {
				const resourceTitle = resource.charAt(0).toUpperCase() + resource.slice(1);
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getFullDetail',
							ERROR_TYPES.ENTITY_NOT_FOUND,
							`${resourceTitle} with ID ${resolvedDetailId} not found.`,
							`Verify the ${resource} ID and retry autotask_${resource} with operation 'getMany'.`,
						),
					),
					correlationId,
				);
			}

			const detailRecord = rawFullDetailTicket as Record<string, unknown>;

			// Fetch child counts for ALL modes — childCountEntities is now populated for ticket (sla mode) too.
			const childCounts: Record<string, number> = {};
			const childCountErrors: string[] = [];
			if (cfg.childCountEntities.length > 0) {
				const numericId = Number(resolvedDetailId);
				const countResults = await Promise.all(
					cfg.childCountEntities.map(async (entry) => {
						try {
							const resp = await autotaskApiRequest.call(
								context,
								'POST',
								`${entry.queryEndpoint}/count`,
								{
									filter: [{ field: entry.parentField, op: 'eq', value: numericId }],
								} as IDataObject,
							) as { queryCount?: number };
							const count = typeof resp.queryCount === 'number' ? resp.queryCount : 0;
							return { key: entry.key, count };
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							return { key: entry.key, count: null as number | null, error: msg };
						}
					}),
				);
				for (const r of countResults) {
					if (r.count !== null) {
						childCounts[r.key] = r.count;
					} else if ('error' in r) {
						childCountErrors.push(`${r.key}: ${r.error}`);
					}
				}
			}
			const childCountsSpread = Object.keys(childCounts).length > 0 ? { childCounts } : {};
			const childCountErrorsSpread = childCountErrors.length > 0 ? { _childCountErrors: childCountErrors } : {};

			let fullDetailRecord: Record<string, unknown>;
			if (cfg.getFullDetailMode === 'sla') {
				const fdTicket = detailRecord;
				// Derive SLA status from ticket fields — no extra API call needed
				const fdHasSla = fdTicket.serviceLevelAgreementID !== undefined && fdTicket.serviceLevelAgreementID !== null;
				const fdMet = fdTicket.serviceLevelAgreementHasBeenMet;
				const fdPausedHours = fdTicket.serviceLevelAgreementPausedNextEventHours;
				let fdSlaStatus: string;
				if (!fdHasSla) {
					fdSlaStatus = 'no_sla';
				} else if (typeof fdPausedHours === 'number' && fdPausedHours > 0) {
					fdSlaStatus = 'paused';
				} else if (fdMet === false) {
					fdSlaStatus = 'breached';
				} else if (fdMet === true) {
					fdSlaStatus = 'compliant';
				} else {
					fdSlaStatus = 'unknown';
				}

				// Build a simple plain-text summary from available ticket fields
				const fdTicketNumber = fdTicket.ticketNumber ?? '';
				const fdTitle = fdTicket.title ?? '';
				const fdStatusLabel = fdTicket.status_label ?? fdTicket.status ?? '';
				const fdCompanyLabel = fdTicket.companyID_label ?? fdTicket.companyName ?? '';
				const fdSummaryText = [
					fdTicketNumber ? `Ticket ${String(fdTicketNumber)}` : `Ticket ${resolvedDetailId}`,
					fdTitle ? `"${String(fdTitle)}"` : '',
					fdStatusLabel ? `[${String(fdStatusLabel)}]` : '',
					fdCompanyLabel ? `— ${String(fdCompanyLabel)}` : '',
				].filter(Boolean).join(' ');

				fullDetailRecord = {
					...fdTicket,
					...childCountsSpread,
					slaStatus: fdSlaStatus,
					slaBreachDateTime: fdTicket.resolvedDueDateTime ?? null,
					summaryText: fdSummaryText,
					...childCountErrorsSpread,
				};
			} else {
				// 'simple' mode — task/project.
				const recordTitle = (detailRecord.title ?? detailRecord.projectName ?? detailRecord.name ?? '') as string;
				const recordStatusLabel = (detailRecord.status_label ?? detailRecord.status ?? '') as string;
				const recordCompanyLabel = (detailRecord.companyID_label ?? detailRecord.companyName ?? '') as string;
				const summaryText = [
					`${resource.charAt(0).toUpperCase()}${resource.slice(1)} ${resolvedDetailId}`,
					recordTitle ? `"${String(recordTitle)}"` : '',
					recordStatusLabel ? `[${String(recordStatusLabel)}]` : '',
					recordCompanyLabel ? `— ${String(recordCompanyLabel)}` : '',
				].filter(Boolean).join(' ');
				fullDetailRecord = {
					...detailRecord,
					...childCountsSpread,
					summaryText,
					...childCountErrorsSpread,
				};
			}

			const fullDetailJson = JSON.stringify(
				buildItemResponse(resource, 'getFullDetail', fullDetailRecord),
			);
			const enrichedFullDetailJson = await enrichResponseJson(fullDetailJson, context);
			return attachCorrelation(enrichedFullDetailJson, correlationId);
		}

		// Short-circuit: countByPeriod
		if (effectiveOperation === 'countByPeriod') {
			const cfg = getConvenienceConfig(resource)!;
			const validPeriods = ['today', 'this_week', 'last_7d', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'last_30d', 'last_90d'] as const;
			const periodParam = params.period as string | undefined;
			if (!periodParam || !(validPeriods as readonly string[]).includes(periodParam)) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'countByPeriod',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							`'period' is required. Valid values: ${validPeriods.join(', ')}.`,
							`Call autotask_${resource} with operation 'countByPeriod' and period set to one of the valid values.`,
						),
					),
					correlationId,
				);
			}

			function resolvePeriodBounds(period: string, now: Date): { from: string; to: string } {
				const y = now.getUTCFullYear();
				const m = now.getUTCMonth(); // 0-based
				const d = now.getUTCDate();
				switch (period) {
					case 'today':
						return {
							from: new Date(Date.UTC(y, m, d)).toISOString(),
							to: new Date(Date.UTC(y, m, d + 1)).toISOString(),
						};
					case 'this_week': {
						const dow = now.getUTCDay(); // 0=Sun
						const monday = new Date(Date.UTC(y, m, d - ((dow + 6) % 7)));
						return {
							from: monday.toISOString(),
							to: new Date(monday.getTime() + 7 * 86400000).toISOString(),
						};
					}
					case 'last_7d':
						return {
							from: new Date(now.getTime() - 7 * 86400000).toISOString(),
							to: now.toISOString(),
						};
					case 'this_month':
						return {
							from: new Date(Date.UTC(y, m, 1)).toISOString(),
							to: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
						};
					case 'last_month':
						return {
							from: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
							to: new Date(Date.UTC(y, m, 1)).toISOString(),
						};
					case 'this_quarter': {
						const qStart = Math.floor(m / 3) * 3;
						return {
							from: new Date(Date.UTC(y, qStart, 1)).toISOString(),
							to: new Date(Date.UTC(y, qStart + 3, 1)).toISOString(),
						};
					}
					case 'last_quarter': {
						const lqStart = Math.floor(m / 3) * 3 - 3;
						const lqYear = lqStart < 0 ? y - 1 : y;
						const lqMonth = ((lqStart % 12) + 12) % 12;
						return {
							from: new Date(Date.UTC(lqYear, lqMonth, 1)).toISOString(),
							to: new Date(Date.UTC(lqYear, lqMonth + 3, 1)).toISOString(),
						};
					}
					case 'last_30d':
						return {
							from: new Date(now.getTime() - 30 * 86400000).toISOString(),
							to: now.toISOString(),
						};
					case 'last_90d':
						return {
							from: new Date(now.getTime() - 90 * 86400000).toISOString(),
							to: now.toISOString(),
						};
					default:
						throw new Error(`Unknown period: '${period}'`);
				}
			}

			const cbpNow = new Date();
			const { from: cbpFrom, to: cbpTo } = resolvePeriodBounds(periodParam, cbpNow);

			// Optional filters: company, status, priority
			const cbpOptional: ToolFilter[] = [];
			if (cfg.companyFilterStrategy === 'direct' && params.company !== undefined && params.company !== null) {
				cbpOptional.push({ field: 'companyID', op: 'eq', value: params.company as string | number });
			}
			if (params.status !== undefined && params.status !== null) {
				cbpOptional.push({ field: 'status', op: 'eq', value: params.status as string | number });
			}
			if (cfg.hasPriority && params.priority !== undefined && params.priority !== null) {
				cbpOptional.push({ field: 'priority', op: 'eq', value: params.priority as string | number });
			}

			let cbpResolutions: LabelResolution[] = [];
			let cbpWarnings: string[] = [];
			let cbpPending: PendingLabelConfirmation[] = [];
			let cbpUnresolved: ToolFilter[] = [];

			if (cbpOptional.length > 0) {
				const cbpResolved = await resolveAndClassifyFilters(context, resource, cbpOptional, readFields, params as IDataObject);
				cbpResolutions = cbpResolved.resolutions;
				cbpWarnings = cbpResolved.warnings;
				cbpPending = cbpResolved.pendingConfirmations;
				cbpUnresolved = cbpResolved.unresolvedIdLikeFilters;
			}

			if (cbpUnresolved.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'countByPeriod',
							ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Could not resolve: ${cbpUnresolved.map((f) => `${f.field}='${String(f.value)}'`).join(', ')}`,
							`Verify names or use numeric IDs.`,
							{ pendingConfirmations: cbpPending.length > 0 ? cbpPending : undefined },
						),
					),
					correlationId,
				);
			}

			// viaProject company filter resolution (e.g. task → projects → projectID-IN)
			if (cfg.companyFilterStrategy === 'viaProject' && params.company !== undefined && params.company !== null) {
				const r = await resolveCompanyToProjectIdFilter(context, params.company as string | number, 'countByPeriod', resource);
				if ('error' in r) return attachCorrelation(JSON.stringify(r.error), correlationId);
				if ('empty' in r) {
					const emptyCountResponse: Record<string, unknown> = {
						...buildCountResponse(resource, 'countByPeriod', 0),
						period: periodParam,
						from: cbpFrom,
						to: cbpTo,
						warnings: [`No projects found for company '${String(params.company)}'.`],
					};
					return attachCorrelation(JSON.stringify(emptyCountResponse), correlationId);
				}
				cbpOptional.unshift(r.filter);
				if (r.warning) cbpWarnings.push(r.warning);
			}

			const cbpAllFilters: unknown[] = [
				{ field: cfg.createDateField, op: 'gte', value: cbpFrom },
				{ field: cfg.createDateField, op: 'lt', value: cbpTo },
				...cbpOptional,
			];

			const cbpCount = await executeCountOperation(resource, cbpAllFilters, context);

			const cbpAllWarnings = [...cbpWarnings, ...labelWarnings];
			const cbpAllResolutions = [...cbpResolutions, ...labelResolutions];

			const cbpBaseResponse = buildCountResponse(resource, 'countByPeriod', cbpCount ?? 0);
			const cbpResponse: Record<string, unknown> = {
				...cbpBaseResponse,
				period: periodParam,
				from: cbpFrom,
				to: cbpTo,
				...(cbpAllResolutions.length > 0 ? { resolvedLabels: cbpAllResolutions } : {}),
				...(cbpAllWarnings.length > 0 ? { warnings: cbpAllWarnings } : {}),
			};
			return attachCorrelation(JSON.stringify(cbpResponse), correlationId);
		}

		// Short-circuit: getByAge
		if (effectiveOperation === 'getByAge') {
			const cfg = getConvenienceConfig(resource)!;
			const olderThanDays = params.olderThanDays;
			if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays) || olderThanDays <= 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getByAge',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							"'olderThanDays' must be a positive number (e.g. 30 for tickets older than 30 days).",
							`Call autotask_${resource} with operation 'getByAge' and provide a positive number for 'olderThanDays'.`,
						),
					),
					correlationId,
				);
			}

			const cutoffDate = new Date(Date.now() - Math.trunc(olderThanDays) * 86400000);
			const ageBaseFilters: ToolFilter[] = [
				{ field: cfg.createDateField, op: 'lt', value: cutoffDate.toISOString() },
			];

			const ageOptionalFilters: ToolFilter[] = [];
			if (cfg.companyFilterStrategy === 'direct' && params.company !== undefined && params.company !== null) ageOptionalFilters.push({ field: 'companyID', op: 'eq', value: params.company as string | number });
			if (params.status !== undefined && params.status !== null) ageOptionalFilters.push({ field: 'status', op: 'eq', value: params.status as string | number });
			if (cfg.hasPriority && params.priority !== undefined && params.priority !== null) ageOptionalFilters.push({ field: 'priority', op: 'eq', value: params.priority as string | number });

			let ageResolutions: any[] = [];
			let ageWarnings: string[] = [];
			let agePending: any[] = [];
			let ageUnresolved: ToolFilter[] = [];

			if (ageOptionalFilters.length > 0) {
				const ageResolved = await resolveAndClassifyFilters(context, resource, ageOptionalFilters, readFields, params as IDataObject);
				ageResolutions = ageResolved.resolutions;
				ageWarnings = ageResolved.warnings;
				agePending = ageResolved.pendingConfirmations;
				ageUnresolved = ageResolved.unresolvedIdLikeFilters;
			}

			if (ageUnresolved.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(resource, 'getByAge', ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Could not resolve: ${ageUnresolved.map((f) => `${f.field}='${String(f.value)}'`).join(', ')}`,
							`Verify names or use numeric IDs. For status/priority, call autotask_${resource} with operation 'listPicklistValues'.`,
							{ pendingConfirmations: agePending.length > 0 ? agePending : undefined }),
					),
					correlationId,
				);
			}

			// viaProject company filter resolution (e.g. task → projects → projectID-IN)
			if (cfg.companyFilterStrategy === 'viaProject' && params.company !== undefined && params.company !== null) {
				const r = await resolveCompanyToProjectIdFilter(context, params.company as string | number, 'getByAge', resource);
				if ('error' in r) return attachCorrelation(JSON.stringify(r.error), correlationId);
				if ('empty' in r) {
					return attachCorrelation(
						JSON.stringify(
							buildListResponse(resource, 'getByAge', [], {
								hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT,
							}, {
								resolutionWarnings: [`No projects found for company '${String(params.company)}'.`],
							}),
						),
						correlationId,
					);
				}
				ageOptionalFilters.unshift(r.filter);
				if (r.warning) ageWarnings.push(r.warning);
			}

			const ageAllFilters: ToolFilter[] = [...ageBaseFilters, ...ageOptionalFilters, ...(recencyResult.filters as ToolFilter[])];
			const ageQueryLimit = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit) : DEFAULT_QUERY_LIMIT);
			const ageRequestBody: IDataObject = { filter: ageAllFilters as unknown as IDataObject[] };
			if (ageQueryLimit !== undefined) ageRequestBody.MaxRecords = ageQueryLimit;

			const ageResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, ageRequestBody) as { items?: IAutotaskEntity[] };
			const ageItems = Array.isArray(ageResponse.items) ? ageResponse.items as Record<string, unknown>[] : [];

			const ageAllWarnings = [...ageWarnings, ...labelWarnings];
			const ageAllResolutions = [...ageResolutions, ...labelResolutions];

			const ageListJson = JSON.stringify(
				buildListResponse(resource, 'getByAge', ageItems, {
					hasMore: ageQueryLimit !== undefined && ageItems.length >= ageQueryLimit,
					serverCap: ageQueryLimit ?? MAX_QUERY_LIMIT,
					clientCap: ageQueryLimit ?? MAX_QUERY_LIMIT,
				}, {
					resolutions: ageAllResolutions.length > 0 ? ageAllResolutions : undefined,
					resolutionWarnings: ageAllWarnings.length > 0 ? ageAllWarnings : undefined,
					pendingConfirmations: agePending.length > 0 ? agePending : undefined,
				}),
			);
			const enrichedAgeJson = await enrichResponseJson(ageListJson, context);
			return attachCorrelation(enrichedAgeJson, correlationId);
		}

		// Short-circuit: getByResource (ticket-scoped — primary + secondary assignment lookup)
		if (effectiveOperation === 'getByResource' && resource === 'ticket') {
			const cfg = getConvenienceConfig(resource)!;

			// 1. Validate + resolve resourceID
			const rawResourceId = (params as Record<string, unknown>).resourceID;
			if (rawResourceId === undefined || rawResourceId === null || String(rawResourceId).trim() === '') {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'getByResource',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							"'resourceID' is required for getByResource.",
							`Call autotask_${resource} with operation 'getByResource' and provide 'resourceID' as a name, email, or numeric ID.`,
						),
					),
					correlationId,
				);
			}

			let resourceIdNum: number;
			let searchedResource: { id: number; name: string | null; email: string | null } = {
				id: 0,
				name: null,
				email: null,
			};
			const gbrResolutions: LabelResolution[] = [];
			const gbrWarnings: string[] = [];
			const rawStr = String(rawResourceId).trim();
			const isNumericResource =
				typeof rawResourceId === 'number' ||
				(/^\d+$/.test(rawStr) && String(parseInt(rawStr, 10)) === rawStr && parseInt(rawStr, 10) > 0);

			if (isNumericResource) {
				resourceIdNum = typeof rawResourceId === 'number' ? rawResourceId : parseInt(rawStr, 10);
				// Fetch the Resource record to populate searchedResource (best-effort).
				try {
					const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
					const helper = new EntityValueHelper(
						context as unknown as ILoadOptionsFunctions,
						'Resource',
					);
					const fetched = (await helper.getValuesByIds(
						[resourceIdNum],
						['id', 'firstName', 'lastName', 'email'],
					)) as Record<string, unknown>[];
					const rec = Array.isArray(fetched) && fetched.length > 0 ? fetched[0] : undefined;
					if (rec) {
						const firstName = rec['firstName'] !== undefined && rec['firstName'] !== null
							? String(rec['firstName'])
							: '';
						const lastName = rec['lastName'] !== undefined && rec['lastName'] !== null
							? String(rec['lastName'])
							: '';
						const fullName = [firstName, lastName].filter(Boolean).join(' ');
						searchedResource = {
							id: resourceIdNum,
							name: fullName || null,
							email: rec['email'] !== undefined && rec['email'] !== null
								? String(rec['email'])
								: null,
						};
					} else {
						searchedResource = { id: resourceIdNum, name: null, email: null };
					}
				} catch {
					// Non-fatal: keep numeric id; name/email null
					searchedResource = { id: resourceIdNum, name: null, email: null };
				}
			} else {
				try {
					const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
					const helper = new EntityValueHelper(
						context as unknown as ILoadOptionsFunctions,
						'Resource',
					);
					const candidates = await helper.getValues(true);
					const label = rawStr.toLowerCase();
					let matchedId: number | undefined;
					let matchedObj: IDataObject | undefined;
					for (const entity of candidates) {
						const obj = entity as unknown as IDataObject;
						const display = helper.getEntityDisplayName(obj);
						if (display && display.toLowerCase() === label) {
							matchedId = obj.id as number;
							matchedObj = obj;
							break;
						}
						const emails = [obj.email, obj.email2, obj.email3] as (string | undefined)[];
						if (emails.some((e) => e && e.toLowerCase() === label)) {
							matchedId = obj.id as number;
							matchedObj = obj;
							break;
						}
					}
					if (matchedId === undefined) {
						return attachCorrelation(
							JSON.stringify(
								wrapError(
									resource,
									'getByResource',
									ERROR_TYPES.ENTITY_NOT_FOUND,
									`Resource '${rawStr}' not found.`,
									`Verify the resource name or email is exact, or use a numeric resourceID. Call autotask_resource with operation 'getMany' to list active resources.`,
								),
							),
							correlationId,
						);
					}
					resourceIdNum = matchedId;
					if (matchedObj) {
						const firstName = matchedObj['firstName'] !== undefined && matchedObj['firstName'] !== null
							? String(matchedObj['firstName'])
							: '';
						const lastName = matchedObj['lastName'] !== undefined && matchedObj['lastName'] !== null
							? String(matchedObj['lastName'])
							: '';
						const fullName = [firstName, lastName].filter(Boolean).join(' ');
						searchedResource = {
							id: matchedId,
							name: fullName || null,
							email: matchedObj['email'] !== undefined && matchedObj['email'] !== null
								? String(matchedObj['email'])
								: null,
						};
					} else {
						searchedResource = { id: matchedId, name: null, email: null };
					}
					gbrResolutions.push({
						field: 'resourceID',
						from: rawStr,
						to: matchedId,
						method: 'reference',
					} as LabelResolution);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return attachCorrelation(
						JSON.stringify(
							wrapError(
								resource,
								'getByResource',
								ERROR_TYPES.API_ERROR,
								`Resource lookup failed: ${msg}`,
								`Provide a numeric resourceID instead of a name or email.`,
							),
						),
						correlationId,
					);
				}
			}

			// 2. Validate mode (default 'both')
			const modeRaw = (params as Record<string, unknown>).mode;
			const mode = (typeof modeRaw === 'string' && ['primary', 'secondary', 'both'].includes(modeRaw)
				? modeRaw
				: 'both') as 'primary' | 'secondary' | 'both';

			// 3. Common filter slices
			const effectiveReturnAllGbr = params.returnAll === true;
			const queryLimitForOp = effectiveReturnAllGbr
				? undefined
				: params.limit !== undefined
					? getEffectiveLimit(params.limit)
					: DEFAULT_QUERY_LIMIT;
			const excludeTerminalGbr = (params as Record<string, unknown>).excludeTerminalStatuses !== false;
			const terminalFilterGbr: ToolFilter | null =
				excludeTerminalGbr && cfg.terminalStatusIds.length > 0
					? { field: 'status', op: 'notIn', value: cfg.terminalStatusIds }
					: null;
			const recencyFiltersGbr = recencyResult.filters as ToolFilter[];

			// 4. Primary path
			let primaryItems: Record<string, unknown>[] = [];
			if (mode === 'primary' || mode === 'both') {
				const primaryFilters: ToolFilter[] = [
					{ field: 'assignedResourceID', op: 'eq', value: resourceIdNum },
					...(terminalFilterGbr ? [terminalFilterGbr] : []),
					...recencyFiltersGbr,
				];
				const primaryBody: IDataObject = { filter: primaryFilters as unknown as IDataObject[] };
				if (queryLimitForOp !== undefined) primaryBody.MaxRecords = queryLimitForOp;
				const primaryResp = (await autotaskApiRequest.call(
					context,
					'POST',
					cfg.queryEndpoint,
					primaryBody,
				)) as { items?: IAutotaskEntity[] };
				primaryItems = Array.isArray(primaryResp.items)
					? (primaryResp.items as Record<string, unknown>[])
					: [];
			}

			// 5. Secondary path
			let secondaryItems: Record<string, unknown>[] = [];
			if (mode === 'secondary' || mode === 'both') {
				const SEC_ASSIGNMENT_CAP = 500;
				const secAssignmentBody: IDataObject = {
					filter: [
						{ field: 'resourceID', op: 'eq', value: resourceIdNum },
					] as unknown as IDataObject[],
					MaxRecords: SEC_ASSIGNMENT_CAP,
					IncludeFields: ['ticketID'],
				};
				const secResp = (await autotaskApiRequest.call(
					context,
					'POST',
					'TicketSecondaryResources/query',
					secAssignmentBody,
				)) as { items?: IAutotaskEntity[] };
				const secAssignments = Array.isArray(secResp.items) ? secResp.items : [];
				const ticketIds = [
					...new Set(
						secAssignments
							.map((a) => Number((a as IDataObject).ticketID))
							.filter(Number.isFinite),
					),
				];
				if (secAssignments.length >= SEC_ASSIGNMENT_CAP) {
					gbrWarnings.push(
						`Secondary assignment lookup hit cap (${SEC_ASSIGNMENT_CAP} rows). Some secondary assignments may be missing — narrow with recency or since/until.`,
					);
				}
				if (ticketIds.length > 0) {
					const primaryIdSet = new Set(
						primaryItems.map((t) => Number(t.id)).filter(Number.isFinite),
					);
					const newTicketIds = ticketIds.filter((id) => !primaryIdSet.has(id));
					if (newTicketIds.length > 0) {
						const secTicketFilters: ToolFilter[] = [
							{ field: 'id', op: 'in', value: newTicketIds },
							...(terminalFilterGbr ? [terminalFilterGbr] : []),
							...recencyFiltersGbr,
						];
						const secTicketBody: IDataObject = {
							filter: secTicketFilters as unknown as IDataObject[],
						};
						if (queryLimitForOp !== undefined) secTicketBody.MaxRecords = queryLimitForOp;
						const secTicketResp = (await autotaskApiRequest.call(
							context,
							'POST',
							cfg.queryEndpoint,
							secTicketBody,
						)) as { items?: IAutotaskEntity[] };
						secondaryItems = Array.isArray(secTicketResp.items)
							? (secTicketResp.items as Record<string, unknown>[])
							: [];
					}
				}
			}

			// 6. Merge + dedupe (annotate with _matchedAs)
			const mergedMap = new Map<number, Record<string, unknown>>();
			for (const t of primaryItems) {
				const id = Number(t.id);
				if (!Number.isFinite(id)) continue;
				mergedMap.set(id, { ...t, _matchedAs: ['primary'] });
			}
			for (const t of secondaryItems) {
				const id = Number(t.id);
				if (!Number.isFinite(id)) continue;
				const existing = mergedMap.get(id);
				if (existing) {
					(existing._matchedAs as string[]).push('secondary');
				} else {
					mergedMap.set(id, { ...t, _matchedAs: ['secondary'] });
				}
			}
			const mergedItems = [...mergedMap.values()];

			// 7. Build response
			const allGbrWarnings = [...gbrWarnings, ...labelWarnings];
			const allGbrResolutions = [...gbrResolutions, ...labelResolutions];
			const gbrJson = JSON.stringify(
				buildListResponse(
					resource,
					'getByResource',
					mergedItems,
					{
						hasMore: queryLimitForOp !== undefined && mergedItems.length >= queryLimitForOp,
						serverCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
						clientCap: queryLimitForOp ?? MAX_QUERY_LIMIT,
					},
					{
						resolutions: allGbrResolutions.length > 0 ? allGbrResolutions : undefined,
						resolutionWarnings: allGbrWarnings.length > 0 ? allGbrWarnings : undefined,
					},
				),
			);
			// Inject top-level descriptor so the LLM does not need to remember
			// the input resource identity across many returned ticket records.
			const gbrParsed = JSON.parse(gbrJson) as Record<string, unknown>;
			gbrParsed['searchedResource'] = searchedResource;
			gbrParsed['searchMode'] = mode;
			const gbrJsonFinal = JSON.stringify(gbrParsed);
			const enrichedGbrJson = await enrichResponseJson(gbrJsonFinal, context);
			return attachCorrelation(enrichedGbrJson, correlationId);
		}

		// Short-circuit: searchByKeyword
		// Cross-entity full-text search across Tickets, TicketNotes, TimeEntries.
		// Stages 1–3 run in parallel via Promise.allSettled; per-stage failures degrade gracefully.
		// Recency is applied post-merge against the resolved recency field (default createDate).
		if (effectiveOperation === 'searchByKeyword') {
			const SEARCH_BY_KEYWORD_STAGE_CAP = 200;

			const keywordRaw = (params as Record<string, unknown>).keyword;
			const keyword = typeof keywordRaw === 'string' ? keywordRaw.trim() : '';
			if (!keyword) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'searchByKeyword',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							"'keyword' is required for searchByKeyword (non-empty string).",
							`Call autotask_${resource} with operation 'searchByKeyword' and provide 'keyword'.`,
						),
					),
					correlationId,
				);
			}

			const includeNotes = (params as Record<string, unknown>).includeNotes === true;
			const includeTimeEntries = (params as Record<string, unknown>).includeTimeEntries === true;

			// Stage 1: Tickets/query — title OR description contains keyword
			const stage1Body: IDataObject = {
				filter: [
					{
						op: 'or',
						items: [
							{ field: 'title', op: 'contains', value: keyword },
							{ field: 'description', op: 'contains', value: keyword },
						],
					},
				] as unknown as IDataObject[],
				MaxRecords: SEARCH_BY_KEYWORD_STAGE_CAP,
			};

			// Stage 2: TicketNotes/query — description contains keyword (only if requested)
			const stage2Body: IDataObject | null = includeNotes
				? {
						filter: [
							{ field: 'description', op: 'contains', value: keyword },
						] as unknown as IDataObject[],
						MaxRecords: SEARCH_BY_KEYWORD_STAGE_CAP,
					}
				: null;

			// Stage 3: TimeEntries/query — summaryNotes contains keyword (only if requested)
			const stage3Body: IDataObject | null = includeTimeEntries
				? {
						filter: [
							{ field: 'summaryNotes', op: 'contains', value: keyword },
						] as unknown as IDataObject[],
						MaxRecords: SEARCH_BY_KEYWORD_STAGE_CAP,
					}
				: null;

			const [stage1Settled, stage2Settled, stage3Settled] = await Promise.allSettled([
				autotaskApiRequest.call(context, 'POST', 'Tickets/query', stage1Body) as Promise<{
					items?: IAutotaskEntity[];
				}>,
				stage2Body
					? (autotaskApiRequest.call(context, 'POST', 'TicketNotes/query', stage2Body) as Promise<{
							items?: IAutotaskEntity[];
						}>)
					: Promise.resolve<{ items?: IAutotaskEntity[] }>({ items: [] }),
				stage3Body
					? (autotaskApiRequest.call(context, 'POST', 'TimeEntries/query', stage3Body) as Promise<{
							items?: IAutotaskEntity[];
						}>)
					: Promise.resolve<{ items?: IAutotaskEntity[] }>({ items: [] }),
			]);

			const stageWarnings: string[] = [];

			const stage1Items: Record<string, unknown>[] =
				stage1Settled.status === 'fulfilled' && Array.isArray(stage1Settled.value.items)
					? (stage1Settled.value.items as Record<string, unknown>[])
					: [];
			if (stage1Settled.status === 'rejected') {
				const msg =
					stage1Settled.reason instanceof Error
						? stage1Settled.reason.message
						: String(stage1Settled.reason);
				return attachCorrelation(
					JSON.stringify(
						formatApiError(
							`Ticket search (stage 1) failed: ${msg}`,
							resource,
							'searchByKeyword',
						),
					),
					correlationId,
				);
			}

			const stage2Items: Record<string, unknown>[] =
				stage2Settled.status === 'fulfilled' && Array.isArray(stage2Settled.value.items)
					? (stage2Settled.value.items as Record<string, unknown>[])
					: [];
			if (includeNotes && stage2Settled.status === 'rejected') {
				const msg =
					stage2Settled.reason instanceof Error
						? stage2Settled.reason.message
						: String(stage2Settled.reason);
				stageWarnings.push(
					`TicketNotes search failed: ${msg}. Results omit notes-only matches.`,
				);
			}

			const stage3Items: Record<string, unknown>[] =
				stage3Settled.status === 'fulfilled' && Array.isArray(stage3Settled.value.items)
					? (stage3Settled.value.items as Record<string, unknown>[])
					: [];
			if (includeTimeEntries && stage3Settled.status === 'rejected') {
				const msg =
					stage3Settled.reason instanceof Error
						? stage3Settled.reason.message
						: String(stage3Settled.reason);
				stageWarnings.push(
					`TimeEntries search failed: ${msg}. Results omit time-entry-only matches.`,
				);
			}

			// Build merged ticket map keyed by id (string), with matchedIn Set per record.
			const merged = new Map<string, { record: Record<string, unknown>; matchedIn: Set<string> }>();

			const lowerKeyword = keyword.toLowerCase();
			for (const ticket of stage1Items) {
				const id = ticket.id;
				if (id === undefined || id === null) continue;
				const key = String(id);
				const matched = new Set<string>();
				const titleVal = typeof ticket.title === 'string' ? ticket.title.toLowerCase() : '';
				const descVal =
					typeof ticket.description === 'string' ? ticket.description.toLowerCase() : '';
				if (titleVal.includes(lowerKeyword)) matched.add('title');
				if (descVal.includes(lowerKeyword)) matched.add('description');
				if (matched.size === 0) matched.add('title');
				merged.set(key, { record: ticket, matchedIn: matched });
			}

			// Collect ticket IDs from stages 2 and 3
			const noteTicketIds = new Set<string>();
			for (const note of stage2Items) {
				const tid = note.ticketID;
				if (tid !== undefined && tid !== null) noteTicketIds.add(String(tid));
			}
			const timeEntryTicketIds = new Set<string>();
			for (const te of stage3Items) {
				const tid = te.ticketID;
				if (tid !== undefined && tid !== null) timeEntryTicketIds.add(String(tid));
			}

			// Stage 4: GET /Tickets/{id} for IDs from stages 2/3 not already in stage 1
			const idsToFetch = new Set<string>();
			for (const tid of noteTicketIds) if (!merged.has(tid)) idsToFetch.add(tid);
			for (const tid of timeEntryTicketIds) if (!merged.has(tid)) idsToFetch.add(tid);

			if (idsToFetch.size > 0) {
				const fetched = await Promise.allSettled(
					[...idsToFetch].map(
						(tid) =>
							autotaskApiRequest.call(context, 'GET', `Tickets/${tid}`) as Promise<{
								item?: IAutotaskEntity;
							}>,
					),
				);
				let stage4Failures = 0;
				for (const settled of fetched) {
					if (
						settled.status === 'fulfilled' &&
						settled.value.item &&
						typeof settled.value.item === 'object'
					) {
						const ticket = settled.value.item as Record<string, unknown>;
						const tid = ticket.id;
						if (tid === undefined || tid === null) continue;
						const key = String(tid);
						if (!merged.has(key)) {
							merged.set(key, { record: ticket, matchedIn: new Set() });
						}
					} else if (settled.status === 'rejected') {
						stage4Failures += 1;
					}
				}
				if (stage4Failures > 0) {
					stageWarnings.push(
						`${stage4Failures} ticket fetch(es) failed during stage 4 — some matched tickets may be missing from results.`,
					);
				}
			}

			// Tag matchedIn for note / time-entry hits AFTER stage-4 fetches
			for (const tid of noteTicketIds) {
				const entry = merged.get(tid);
				if (entry) entry.matchedIn.add('notes');
			}
			for (const tid of timeEntryTicketIds) {
				const entry = merged.get(tid);
				if (entry) entry.matchedIn.add('timeEntries');
			}

			// Materialise records with matchedIn as a stable-ordered array
			const ORDER = ['title', 'description', 'notes', 'timeEntries'] as const;
			let mergedRecords: Record<string, unknown>[] = [...merged.values()].map(
				({ record, matchedIn }) => ({
					...record,
					matchedIn: ORDER.filter((label) => matchedIn.has(label)),
				}),
			);

			// Post-merge recency filter applied client-side against createDate
			if (recencyResult.isActive && recencyResult.filters.length > 0) {
				mergedRecords = mergedRecords.filter((record) => {
					for (const f of recencyResult.filters) {
						const fieldVal = (record as Record<string, unknown>)[f.field];
						if (typeof fieldVal !== 'string') return false;
						const recordTime = Date.parse(fieldVal);
						if (Number.isNaN(recordTime)) return false;
						const boundTime = Date.parse(String(f.value));
						if (Number.isNaN(boundTime)) return false;
						if (f.op === 'gte' && recordTime < boundTime) return false;
						if (f.op === 'lte' && recordTime > boundTime) return false;
					}
					return true;
				});
			}

			const totalMerged = mergedRecords.length;
			const sliceLimit = effectiveReturnAll
				? mergedRecords.length
				: params.limit !== undefined
					? getEffectiveLimit(params.limit)
					: DEFAULT_QUERY_LIMIT;
			const limitedRecords = mergedRecords.slice(0, sliceLimit);

			const searchSummary = {
				keyword,
				includeNotes,
				includeTimeEntries,
				stageMatchCounts: {
					ticketTitleOrDescription: stage1Items.length,
					ticketNotes: includeNotes ? stage2Items.length : 0,
					timeEntries: includeTimeEntries ? stage3Items.length : 0,
				},
				stageCap: SEARCH_BY_KEYWORD_STAGE_CAP,
				stageCapHit: {
					ticketTitleOrDescription: stage1Items.length >= SEARCH_BY_KEYWORD_STAGE_CAP,
					ticketNotes: includeNotes && stage2Items.length >= SEARCH_BY_KEYWORD_STAGE_CAP,
					timeEntries: includeTimeEntries && stage3Items.length >= SEARCH_BY_KEYWORD_STAGE_CAP,
				},
				uniqueMergedTicketCount: totalMerged,
				returnedCount: limitedRecords.length,
			};

			const allWarnings = [...stageWarnings, ...labelWarnings];

			const baseResponse = buildListResponse(
				resource,
				'searchByKeyword',
				limitedRecords,
				{
					hasMore: limitedRecords.length < totalMerged,
					totalAvailable: totalMerged,
					serverCap: SEARCH_BY_KEYWORD_STAGE_CAP,
					clientCap: sliceLimit,
				},
				{
					resolutions: labelResolutions.length > 0 ? labelResolutions : undefined,
					resolutionWarnings: allWarnings.length > 0 ? allWarnings : undefined,
				},
			);

			const responseObject: Record<string, unknown> = {
				...baseResponse,
				searchSummary,
			};

			const searchByKeywordJson = JSON.stringify(responseObject);
			const enrichedSearchByKeywordJson = await enrichResponseJson(searchByKeywordJson, context);
			return attachCorrelation(enrichedSearchByKeywordJson, correlationId);
		}

		// Short-circuit: timeline
		// Merged chronological event stream (TicketNotes + TimeEntries + optional TicketHistory).
		// Parallel fetch via Promise.allSettled; per-stage failures degrade gracefully.
		if (effectiveOperation === 'timeline') {
			const cfg = getConvenienceConfig(resource)!;
			const tlIdPairConfig = getIdentifierPairConfig(resource, 'timeline');
			let timelineTicketId: string | undefined;
			if (params.id !== undefined && params.id !== null) {
				timelineTicketId = String(params.id);
			} else if (tlIdPairConfig && typeof params.ticketNumber === 'string' && params.ticketNumber.trim()) {
				const tnLookup = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, {
					filter: [{ field: tlIdPairConfig.altIdField, op: 'eq', value: params.ticketNumber.trim() }],
					MaxRecords: 1,
				} as IDataObject) as { items?: IAutotaskEntity[] };
				const tnItems = Array.isArray(tnLookup.items) ? tnLookup.items : [];
				if (tnItems.length === 0) {
					return attachCorrelation(
						JSON.stringify(
							wrapError(
								resource,
								'timeline',
								ERROR_TYPES.ENTITY_NOT_FOUND,
								`Ticket with ${tlIdPairConfig.altIdField} '${params.ticketNumber}' not found.`,
								`Verify the ticket number format (e.g. ${tlIdPairConfig.altIdExample}) and retry autotask_${resource} with operation 'getMany'.`,
							),
						),
						correlationId,
					);
				}
				timelineTicketId = String(tnItems[0].id);
			}

			if (!timelineTicketId) {
				const missingMsg = tlIdPairConfig
					? `Either 'id' (numeric) or '${tlIdPairConfig.altIdField}' (e.g. ${tlIdPairConfig.altIdExample}) is required for timeline.`
					: `'id' (numeric) is required for timeline.`;
				const missingNext = tlIdPairConfig
					? `Call autotask_${resource} with operation 'timeline' and provide 'id' or '${tlIdPairConfig.altIdField}'.`
					: `Call autotask_${resource} with operation 'timeline' and provide 'id'.`;
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							'timeline',
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							missingMsg,
							missingNext,
						),
					),
					correlationId,
				);
			}

			const resolvedTimelineTicketId = Number(timelineTicketId);

			// Resolve resourceId string to numeric ID if provided
			let resolvedTimelineResourceId: number | undefined;
			const rawTimelineResourceId = (params as Record<string, unknown>).resourceId;
			if (typeof rawTimelineResourceId === 'string' && rawTimelineResourceId.trim()) {
				const rid = rawTimelineResourceId.trim();
				const numericRid = parseInt(rid, 10);
				if (!isNaN(numericRid) && String(numericRid) === rid) {
					resolvedTimelineResourceId = numericRid;
				} else {
					try {
						const resourceLookup = await autotaskApiRequest.call(
							context, 'POST', 'Resources/query',
							{
								filter: [
									{ op: 'or', items: [
										{ field: 'firstName', op: 'contains', value: rid },
										{ field: 'lastName', op: 'contains', value: rid },
										{ field: 'email', op: 'eq', value: rid },
									]},
								],
								MaxRecords: 1,
							} as IDataObject,
						) as { items?: IAutotaskEntity[] };
						const ridItems = Array.isArray(resourceLookup.items) ? resourceLookup.items : [];
						if (ridItems.length > 0) {
							resolvedTimelineResourceId = Number(ridItems[0].id);
						} else {
							labelWarnings.push(
								`Could not resolve resource '${rid}' to a numeric ID — timeline will not be filtered by resource.`,
							);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						labelWarnings.push(
							`[INFRASTRUCTURE] Resource resolution failed for '${rid}': ${msg} — timeline will not be filtered by resource.`,
						);
					}
				}
			} else if (typeof rawTimelineResourceId === 'number' && rawTimelineResourceId > 0) {
				resolvedTimelineResourceId = rawTimelineResourceId;
			}

			const includeHistories = (params as Record<string, unknown>).includeHistories === true;
			const textLimit = typeof params.textLimit === 'number' ? params.textLimit : 500;
			const timelineLimit = typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), MAX_QUERY_LIMIT) : 50;

			const { buildTicketTimeline } = await import('../helpers/ticket-timeline');
			const timelineResult = await buildTicketTimeline(context as unknown as import('n8n-workflow').IExecuteFunctions, {
				ticketId: resolvedTimelineTicketId,
				since: typeof params.since === 'string' && params.since.trim() ? params.since.trim() : undefined,
				until: typeof params.until === 'string' && params.until.trim() ? params.until.trim() : undefined,
				resourceId: resolvedTimelineResourceId,
				includeHistories,
				textLimit,
				limit: timelineLimit,
			});

			const allTimelineWarnings = [...timelineResult.stageWarnings, ...labelWarnings];

			const baseTimelineResponse = buildListResponse(
				resource,
				'timeline',
				timelineResult.events as unknown as Record<string, unknown>[],
				{
					hasMore: timelineResult.hasMore,
					serverCap: timelineLimit,
					clientCap: timelineLimit,
				},
				{
					resolutions: labelResolutions.length > 0 ? labelResolutions : undefined,
					resolutionWarnings: allTimelineWarnings.length > 0 ? allTimelineWarnings : undefined,
				},
			);

			const timelineResponseObject: Record<string, unknown> = {
				...baseTimelineResponse,
				ticketId: resolvedTimelineTicketId,
				totalEvents: timelineResult.events.length,
				noteCount: timelineResult.noteCount,
				timeEntryCount: timelineResult.timeEntryCount,
				historyCount: timelineResult.historyCount,
			};

			const timelineJson = JSON.stringify(timelineResponseObject);
			const enrichedTimelineJson = await enrichResponseJson(timelineJson, context);
			return attachCorrelation(enrichedTimelineJson, correlationId);
		}

		// Short-circuit: getAvailableRoles (timeEntry resource)
		if (effectiveOperation === 'getAvailableRoles') {
			const rawResourceId = (params as Record<string, unknown>).resourceID;
			if (rawResourceId === undefined || rawResourceId === null || String(rawResourceId).trim() === '') {
				return attachCorrelation(
					JSON.stringify(
						wrapError(resource, 'getAvailableRoles', ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							'resourceID is required.',
							`Call autotask_${resource} with operation 'getAvailableRoles' and provide resourceID.`,
							{ missingFields: ['resourceID'] }),
					),
					correlationId,
				);
			}

			// Resolve resourceID string label → numeric ID if needed
			let resolvedResourceId: number;
			const rawResStr = String(rawResourceId).trim();
			const isNumericRes =
				typeof rawResourceId === 'number' ||
				(/^\d+$/.test(rawResStr) && String(parseInt(rawResStr, 10)) === rawResStr && parseInt(rawResStr, 10) > 0);

			if (isNumericRes) {
				resolvedResourceId = typeof rawResourceId === 'number' ? rawResourceId : parseInt(rawResStr, 10);
			} else {
				try {
					const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
					const helper = new EntityValueHelper(
						context as unknown as ILoadOptionsFunctions,
						'Resource',
					);
					const candidates = await helper.getValues(true);
					const label = rawResStr.toLowerCase();
					let matchedId: number | undefined;
					for (const entity of candidates) {
						const obj = entity as unknown as IDataObject;
						const display = helper.getEntityDisplayName(obj);
						if (display && display.toLowerCase() === label) {
							matchedId = obj.id as number;
							break;
						}
						const emails = [obj.email, obj.email2, obj.email3] as (string | undefined)[];
						if (emails.some((e) => e && e.toLowerCase() === label)) {
							matchedId = obj.id as number;
							break;
						}
					}
					if (matchedId === undefined) {
						return attachCorrelation(
							JSON.stringify(
								wrapError(resource, 'getAvailableRoles', ERROR_TYPES.ENTITY_NOT_FOUND,
									`Resource '${rawResStr}' not found.`,
									`Call autotask_resource with operation 'getMany' to find the correct resource name or ID.`,
									{}),
							),
							correlationId,
						);
					}
					resolvedResourceId = matchedId;
				} catch (e) {
					return attachCorrelation(
						JSON.stringify(
							wrapError(resource, 'getAvailableRoles', ERROR_TYPES.API_ERROR,
								`Resource lookup failed: ${(e as Error).message}`,
								`Provide a numeric resourceID instead.`,
								{}),
						),
						correlationId,
					);
				}
			}

			let queueId = (params as Record<string, unknown>).queueID as number | undefined;
			let contractId = (params as Record<string, unknown>).contractID as number | undefined;
			let suggestedDefaultRoleId: number | undefined;
			const garWarnings: string[] = [];

			// Fetch ticket if ticketID provided and we need queueID/contractID
			const ticketId = (params as Record<string, unknown>).ticketID as number | undefined;
			if (ticketId && (!queueId || !contractId)) {
				try {
					const ticketResponse = await autotaskApiRequest.call(
						context, 'GET', `Tickets/${ticketId}`,
					) as { item?: IAutotaskEntity };
					const ticket = ticketResponse?.item;
					if (ticket) {
						if (!queueId && ticket.queueID) queueId = Number(ticket.queueID);
						if (!contractId && ticket.contractID) contractId = Number(ticket.contractID);
						if (ticket.assignedResourceRoleID) suggestedDefaultRoleId = Number(ticket.assignedResourceRoleID);
					} else {
						garWarnings.push(`Ticket ${ticketId} not found — could not derive queueID/contractID.`);
					}
				} catch (e) {
					garWarnings.push(`Failed to fetch ticket ${ticketId}: ${(e as Error).message}`);
				}
			}

			// Fetch resource roles
			let resourceRoleRows: Array<{ roleID: number; queueID?: number; isActive?: boolean }> = [];
			try {
				const rrResponse = await autotaskApiRequest.call(
					context, 'GET', `Resources/${resolvedResourceId}/Roles`,
				) as { items?: Array<{ roleID: number; queueID?: number; isActive?: boolean }> };
				resourceRoleRows = rrResponse?.items ?? [];
			} catch (e) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(resource, 'getAvailableRoles', ERROR_TYPES.API_ERROR,
							`Failed to fetch roles for resource ${resolvedResourceId}: ${(e as Error).message}`,
							`Verify resourceID is correct using autotask_resource with operation 'get'.`,
							{}),
					),
					correlationId,
				);
			}

			// Filter: active only, and by queueID if known
			let filtered = resourceRoleRows.filter(row => row.isActive !== false);
			if (queueId) {
				const queueFiltered = filtered.filter(row => row.queueID === queueId);
				if (queueFiltered.length > 0) {
					filtered = queueFiltered;
				} else {
					garWarnings.push(`No roles matched queue ${queueId} — returning all active roles for this resource.`);
				}
			}

			// Distinct roleIDs
			let availableRoleIds = [...new Set(filtered.map(row => Number(row.roleID)))];

			// Apply contract exclusions
			if (contractId && availableRoleIds.length > 0) {
				try {
					const exclusionResponse = await autotaskApiRequest.call(
						context, 'POST', 'ContractExclusionRoles/query',
						{
							filter: [{ field: 'contractID', op: 'eq', value: contractId }],
						} as IDataObject,
					) as { items?: Array<{ roleID: number }> };
					const excluded = new Set<number>(
						(exclusionResponse?.items ?? []).map(row => Number(row.roleID))
					);
					const before = availableRoleIds.length;
					availableRoleIds = availableRoleIds.filter(id => !excluded.has(id));
					if (availableRoleIds.length < before) {
						garWarnings.push(`${before - availableRoleIds.length} role(s) excluded by contract ${contractId} exclusion rules.`);
					}
				} catch (e) {
					garWarnings.push(`Could not fetch contract exclusions for contract ${contractId}: ${(e as Error).message}`);
				}
			}

			if (availableRoleIds.length === 0) {
				const garEmptyJson = JSON.stringify(
					buildListResponse(resource, 'getAvailableRoles', [], { hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT }, {
						...(garWarnings.length > 0 ? { resolutionWarnings: garWarnings } : {}),
					}),
				);
				return attachCorrelation(garEmptyJson, correlationId);
			}

			// Batch-fetch Role records
			const { EntityValueHelper: RoleHelper } = await import('../helpers/entity-values/value-helper');
			const roleHelper = new RoleHelper(
				context as unknown as ILoadOptionsFunctions,
				'Role',
			);
			const roleRecords = (await roleHelper.getValuesByIds(availableRoleIds, ['id', 'name', 'description', 'isActive'])) as Record<string, unknown>[];

			// Build output records, flag suggestedDefault
			const garRecords = roleRecords
				.filter(r => r['isActive'] !== false)
				.map(r => ({
					...r,
					...(suggestedDefaultRoleId && Number(r['id']) === suggestedDefaultRoleId
						? { suggestedDefault: true }
						: {}),
				}));

			const garJson = JSON.stringify(
				buildListResponse(resource, 'getAvailableRoles', garRecords,
					{ hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT },
					{
						...(garWarnings.length > 0 ? { resolutionWarnings: garWarnings } : {}),
					},
				),
			);
			const enrichedGarJson = await enrichResponseJson(garJson, context);
			return attachCorrelation(enrichedGarJson, correlationId);
		}

		traceExecutor({
			phase: 'api-call-start',
			resource,
			operation: effectiveOperation,
			correlationId,
			summary: {
				queryLimit,
				hasFilters: combinedFilters.length > 0,
				selectedColumnsCount: selectedColumns.length,
			},
		});
		const needsParallelCount =
			effectiveOperation === 'getMany' &&  // excludes getPosted/getUnposted (cross-entity join; wrong total)
			recencyResult.isActive && !isShortWindow && !effectiveReturnAll;
		const [result, parallelCountResult] = await Promise.all([
			executeToolOperation.call(context),
			needsParallelCount
				? executeCountOperation(resource, combinedFilters, context)
				: Promise.resolve<number | null>(null),
		]);
		const items = result[0] ?? [];
		const fetchedRecords = items.map((item) => item.json);
		const returnedCount = Math.min(fetchedRecords.length, MAX_RESPONSE_RECORDS);
		const isProbablyTruncated =
			fetchedRecords.length > MAX_RESPONSE_RECORDS ||
			(queryLimit !== undefined && fetchedRecords.length >= queryLimit);
		let injectedCount: number | null = null;
		let countQueryFailed = false;
		const countInjectionWarnings: string[] = [];
		if (needsParallelCount) {
			// Path A — parallel count completed alongside fetch
			injectedCount = isProbablyTruncated ? parallelCountResult : null;
			if (isProbablyTruncated && parallelCountResult === null) {
				countQueryFailed = true;
				countInjectionWarnings.push(
					'Count query failed — total matching records unknown for this response.',
				);
			}
		} else if (effectiveOperation === 'getMany' && isProbablyTruncated && !effectiveReturnAll) {
			// Path B — non-recency truncation: sequential count fetch now that we know we need it
			// effectiveOperation guard excludes getPosted/getUnposted (cross-entity join; wrong total)
			injectedCount = await executeCountOperation(resource, combinedFilters, context);
			if (injectedCount === null) {
				countQueryFailed = true;
				countInjectionWarnings.push(
					'Count query failed — total matching records unknown for this response.',
				);
			}
		}
		// Injection guard: count must never be less than what we already returned.
		// Uses returnedCount (post-cap), NOT fetchedRecords.length (pre-cap).
		if (injectedCount !== null && injectedCount < returnedCount) {
			injectedCount = null;
			countInjectionWarnings.push(
				'Count result inconsistent with fetch — total unavailable (records may have changed between calls).',
			);
		}
		let records = fetchedRecords;
		const supportsListResponse = ['getMany', 'getPosted', 'getUnposted'].includes(
			effectiveOperation,
		);
		// Recency takes priority: reverse-sort by date and take first N. Offset is not
		// compatible with recency (recency re-sorts the full window), so ignore offset here.
		// returnAll bypasses the effectiveLimit cap — return all records in the recency window.
		if (recencyResult.isActive && supportsListResponse) {
			const recencySliceLimit = effectiveReturnAll ? fetchedRecords.length : effectiveLimit;
			records = fetchedRecords.slice().reverse().slice(0, recencySliceLimit);
		} else if (effectiveOffset > 0 && supportsListResponse) {
			records = fetchedRecords.slice(effectiveOffset, effectiveOffset + effectiveLimit);
			// Detect offset beyond available records — return clear error instead of
			// misleading "no results found" which could trigger LLM data fabrication.
			if (records.length === 0 && fetchedRecords.length > 0) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							effectiveOperation,
							ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
							`Offset ${effectiveOffset} is beyond the available ${fetchedRecords.length} records. No records remain at this offset.`,
							`Use offset=0 to start from the beginning, or use narrower filters to find specific records.`,
						),
					),
					correlationId,
				);
			}
		}
		// Merge write label resolutions and filter label resolutions
		const allResolutions = [...labelResolutions, ...filterResolutions];
		const allWarnings = [...labelWarnings, ...filterWarnings];
		const allPendingConfirmations = [...labelPendingConfirmations, ...filterPendingConfirmations];
		// When recency is active, offset-based pagination is not supported — add a note
		const recencyOffsetNote =
			recencyResult.isActive && effectiveOffset > 0
				? 'Offset is ignored when recency or since/until is active (recency re-sorts results by date).'
				: undefined;
		// Raw date-pair detection: two filter triplets on the same date field with gte+lte or gt+lt.
		// filtersJson is opaque and intentionally skipped.
		const rawDatePairWarnings: string[] = [];
		if (!params.filtersJson && params.filter_field && params.filter_field_2) {
			const sameField = params.filter_field === params.filter_field_2;
			const opsSet = new Set([params.filter_op, params.filter_op_2]);
			const isRange =
				(opsSet.has('gte') && opsSet.has('lte')) || (opsSet.has('gt') && opsSet.has('lt'));
			if (sameField && isRange) {
				const fieldMeta = readFields.find(
					(f) => f.id.toLowerCase() === (params.filter_field as string).toLowerCase(),
				);
				if (fieldMeta && fieldMeta.type.toLowerCase().includes('date')) {
					rawDatePairWarnings.push(
						`Filtering a date field (${params.filter_field}) with gte+lte or gt+lt is discouraged. ` +
						`Use recency (e.g. last_7d, last_30d) or since/until for date ranges — they encode the time window more clearly.`,
					);
				}
			}
		}
		const mergedWarnings = [...allWarnings, ...countInjectionWarnings, ...rawDatePairWarnings];
		const responseContext: ToolResponseContext = {
			recencyActive: recencyResult.isActive,
			recencyNote: recencyResult.note ?? recencyOffsetNote,
			recencyWindowLimited:
				recencyResult.isActive &&
				!effectiveReturnAll &&
				supportsListResponse &&
				fetchedRecords.length >= RECENCY_OVER_REQUEST_LIMIT,
			resolutions: allResolutions.length > 0 ? allResolutions : undefined,
			resolutionWarnings: mergedWarnings.length > 0 ? mergedWarnings : undefined,
			pendingConfirmations:
				allPendingConfirmations.length > 0 ? allPendingConfirmations : undefined,
			effectiveOffset: recencyResult.isActive ? 0 : effectiveOffset,
			readFields,
			serverCap: queryLimit ?? MAX_QUERY_LIMIT,
			clientCap: MAX_RESPONSE_RECORDS,
			serverCapReached: Boolean(
				supportsListResponse &&
				queryLimit !== undefined &&
				recencyResult.isActive &&
				fetchedRecords.length >= queryLimit,
			),
			// New fields for count injection + completeness framing
			injectedTotalAvailable: injectedCount ?? undefined,
			autoReturnAll,
			wasReturnAll: effectiveReturnAll,
			windowLabel: params.recency ? formatRecencyWindowLabel(params.recency) ?? undefined : undefined,
			countQueryFailed: countQueryFailed || undefined,
		};

		// Apply Change Info Field aliases to ticket read results.
		// Note: 'summary' applies aliases internally via buildTicketSummary — do not apply here.
		if (resource === 'ticket' && effectiveOperation !== 'summary') {
			const creds = (await context.getCredentials('autotaskApi')) as IAutotaskCredentials;
			if (shouldApplyAliases(creds)) {
				const aliasMap = buildAliasMap(creds);
				if (effectiveOperation === 'slaHealthCheck') {
					const ticketData = (records[0] as Record<string, unknown>)?.ticket;
					if (ticketData) applyChangeInfoAliases(ticketData as Record<string, unknown>, aliasMap);
				} else {
					for (const rec of records) {
						applyChangeInfoAliases(rec as Record<string, unknown>, aliasMap);
					}
				}
			}
		}

		// Build structured response per operation type
		const formattedResponse = dispatchOperationResponse(
			resource,
			effectiveOperation,
			records,
			params,
			responseContext,
		);
		traceResponse({
			phase: 'operation-complete',
			resource,
			operation: effectiveOperation,
			correlationId,
			durationMs: Date.now() - startedAt,
			summary: {
				...summariseResponseEnvelope(formattedResponse),
				recordsFetchedCount: fetchedRecords.length,
				noResultsClassification: records.length === 0 ? 'empty' : 'non-empty',
			},
		});
		const enrichedResponse = await enrichResponseJson(formattedResponse, context);
		return attachCorrelation(enrichedResponse, correlationId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		traceError({
			phase: 'execute-catch',
			resource,
			operation: effectiveOperation,
			correlationId,
			durationMs: Date.now() - startedAt,
			summary: {
				errorMessage: message,
				beforeApiCall: false,
			},
		});
		return attachCorrelation(
			JSON.stringify(formatApiError(message, resource, effectiveOperation)),
			correlationId,
		);
	} finally {
		context.getNodeParameter = originalGetNodeParameter;
	}
}
