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
} from './error-formatter';
import {
	resolveLabelsToIds,
	type LabelResolution,
	type PendingLabelConfirmation,
} from '../helpers/label-resolution';
import {
	applyChangeInfoAliases,
	buildAliasMap,
	shouldApplyAliases,
} from '../helpers/change-info-aliases';
import { buildOperationDoc } from './description-builders';
import { operationSupportsImpersonation } from '../helpers/impersonation';
import { getIdentifierPairConfig } from '../constants/resource-operations';
import { getConfiguredTimezone } from '../helpers/date-time/utils';
import {
	buildRecencyFilters,
	type RecencyBuildResult,
	AUTO_RETURN_ALL_WINDOW_MS,
	formatRecencyWindowLabel,
} from './recency';
import {
	attachCorrelation,
	buildMetadataResponse,
	type ToolResponseContext,
} from './response-builder';
import {
	dispatchOperationResponse,
	MAX_RESPONSE_RECORDS,
} from './operation-handlers/operation-dispatch';
import {
	handleGetByCompanyAndStatus,
	handleGetUnassigned,
	handleGetBySLAStatus,
	handleGetFullDetail,
	handleCountByPeriod,
	handleGetByAge,
} from './operation-handlers/ticket-convenience';
import {
	handleGetByResource,
	handleSearchByKeyword,
	handleTimeline,
} from './operation-handlers/ticket-specialty';
import { handleGetAvailableRoles } from './operation-handlers/resource-operations';
import { handleCreateIfNotExists } from './operation-handlers/compound-operations';
import { handleSearchNotes } from './operation-handlers/global-notes-search';
import type { ExecutorState } from './executor-state';
import {
	buildFilterFromParams,
	EmptyFilterValueError,
	resolveAndClassifyFilters,
} from './filter-builder';
import type { ToolFilter } from './filter-builder';
export { resolveCompanyToProjectIdFilter } from './filter-builder';
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
import { validateOperationContract, hasProvidedValue } from './operation-contracts';
import { isLikelyId } from '../helpers/id-utils';
import { ENRICHMENT_REGISTRY, enrichResponseJson } from '../helpers/enrichment';
import {
	autotaskApiRequest,
	buildEntityUrl,
	clearImpersonationDenialToken,
	drainImpersonationDenialMarkers,
	registerImpersonationDenialToken,
} from '../helpers/http';
import { AUTOTASK_ENTITIES, entityNameForResource, getEntityMetadata } from '../constants/entities';

/**
 * Lowercased trigger fields of the enrichment registry (ENRICHMENT_REGISTRY in
 * helpers/enrichment.ts — the registry keys ARE the trigger fields
 * enrichResponseJson() reads off each record). The sparse-fields projection
 * keeps these even when not requested, so enrichment keeps firing (X15: the
 * previous hardcoded ticketID/taskID-only keep-set silently disabled every
 * other trigger under sparse `fields` selection).
 *
 * Derived LIVE from the registry: adding an ENRICHMENT_REGISTRY entry needs no
 * change here (the documented contract that enrichment additions are
 * tool-executor-free).
 */
const ENRICHMENT_TRIGGER_FIELDS = [
	...new Set(Object.keys(ENRICHMENT_REGISTRY).map((key) => key.toLowerCase())),
];

/**
 * Coerce an unknown value to boolean, handling Copilot Studio's integer coercion
 * (true → 1, false → 0) and string representations.
 */
function toBool(v: unknown, defaultVal = false): boolean {
	if (v === null || v === undefined) return defaultVal;
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v.toLowerCase() === 'true';
	return defaultVal;
}

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

import {
	DEFAULT_QUERY_LIMIT,
	MAX_QUERY_LIMIT,
	getEffectiveLimit,
	executeCountOperation,
	buildFieldValues,
	promoteReadFieldsToFilters,
	isFilterFieldCovered,
	parseFieldsParam,
	resolveVirtualLabelFields,
	normaliseOperation,
	buildContractViolationNextAction,
} from './tool-executor-helpers';
export { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, getEffectiveLimit, executeCountOperation };
export const RECENCY_OVER_REQUEST_LIMIT = 500;

const SPECIAL_HANDLERS: Record<string, (state: ExecutorState) => Promise<string>> = {
	getByCompanyAndStatus: handleGetByCompanyAndStatus,
	getUnassigned: handleGetUnassigned,
	getBySLAStatus: handleGetBySLAStatus,
	getFullDetail: handleGetFullDetail,
	countByPeriod: handleCountByPeriod,
	getByAge: handleGetByAge,
	getByResource: handleGetByResource,
	searchByKeyword: handleSearchByKeyword,
	timeline: handleTimeline,
	getAvailableRoles: handleGetAvailableRoles,
	searchNotes: handleSearchNotes,
};

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

/**
 * B1 (v2.28.9 r3): the picklist params the convenience handlers validate as
 * "explicit but unusable" (F-5 — status/priority). Single source of truth for
 * both null-collapsing sites:
 *  - `stripAndNormaliseItemJson` (AutotaskAiTools.node.ts, execute() path): a
 *    JSON null here must stay `null` (not `undefined`) so an explicit null is
 *    distinguishable from "not supplied";
 *  - `executeAiTool`'s null→absent normalisation below (BOTH paths): explicit
 *    null must survive to the handlers' `isUnusablePicklistParam` guards so the
 *    precise INVALID_FILTER_CONSTRAINT fires. The handlers error on null BEFORE
 *    any value could reach an API body or filter, so no null can leak downstream.
 * (Other keys keep null→absent: LLMs emit null for "not applicable" fields.)
 */
export const EXPLICITNESS_SENSITIVE_KEYS = new Set<string>(['status', 'priority']);

/**
 * Execute an Autotask operation by routing to the existing tool executor
 * with getNodeParameter overridden to map flat AI tool params.
 */
function supportsListProjection(operation: string): boolean {
	return ['getMany', 'getPosted', 'getUnposted'].includes(operation);
}

// PR #148 SEC-3: per-invocation counter so each executeAiTool() call gets a
// unique impersonation-denial token (see registerImpersonationDenialToken in
// helpers/http/request.ts).
let aiToolDenialTokenSeq = 0;

// PR #148 SEC-3 (x3 V2): drain this execution's impersonation-denial markers
// (request.ts tags them onto the per-call token) into the response warnings
// array. Idempotent — each drain empties the token's queue, so calling it
// more than once per operation is a no-op after the first.
function drainDenialWarningsInto(token: string, warnings: string[]): void {
	for (const denial of drainImpersonationDenialMarkers(token)) {
		warnings.push(
			`impersonation denied for resource ${denial.resourceId} on ${denial.method} ${denial.endpoint}; the request was retried without impersonation and executed as the credential user — the record is attributed to the API user, not the impersonated resource.`,
		);
	}
}

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

	// PR #148 SEC-3: execution-scoped token for the impersonation-denial retry
	// mechanism in request.ts. autotaskApiRequest() tags every denial-retry it
	// performs for this CALL context (or an Object.create(callContext) probe
	// derivative — request.ts walks the prototype chain, so it finds the nearest
	// per-call token); the markers are drained into warnings[] after the
	// operation runs and cleared in the finally block. Legacy standard-node
	// executions never register a token, so they keep the console.warn-only
	// behaviour.
	//
	// Per-call context derivative (x3 V7): supplyData()'s func() arrow closes
	// over ONE shared n8n context object (under the MCP trigger a single
	// long-running execution serves every tool call), so concurrent
	// executeAiTool() invocations all see the same base `context` object.
	// Registering the token on that shared object meant a second call's
	// registerImpersonationDenialToken() overwrote the first call's token in
	// the WeakMap — a denial from call A was attributed to call B's token and
	// A's warnings[] lost it. This call therefore operates on a lightweight
	// per-call derivative (Object.create preserves the base's methods and
	// state through the prototype chain — the same pattern the probe
	// derivatives below use); the base `context` is only read before the
	// derivative is created and is never mutated from this point on.
	const callContext: IExecuteFunctions = Object.create(context);
	const impersonationDenialToken = `ai-denial-${++aiToolDenialTokenSeq}`;
	registerImpersonationDenialToken(callContext, impersonationDenialToken);

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
	// B1 exception: explicit null on the validated picklist params (status/priority,
	// see EXPLICITNESS_SENSITIVE_KEYS) is preserved so the convenience handlers'
	// isUnusablePicklistParam guards reject it with the precise F-5 envelope on
	// BOTH execution paths (previously this delete neutralised F-5's null case
	// process-wide — status:null returned the unfiltered set with no signal).
	for (const key of Object.keys(params)) {
		if (EXPLICITNESS_SENSITIVE_KEYS.has(key)) continue;
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
	// F3 fix (round 2: type-agnostic): 'query' is consumed ONLY by listPicklistValues (it
	// filters picklist values). It previously passed through every other operation silently
	// ignored, so the model believed a full-text search had run. Reject loudly instead of
	// returning unfiltered data. The guard is type-agnostic because the execute() path
	// passes raw item.json past the Zod gate (numeric/boolean query values included).
	if (
		normalisedOperation !== 'listPicklistValues' &&
		params.query != null &&
		String(params.query).trim() !== ''
	) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					normalisedOperation,
					ERROR_TYPES.INVALID_OPERATION,
					`'query' has no effect on operation '${normalisedOperation}' — it only filters picklist values for operation 'listPicklistValues'. It is NOT a full-text search on records.`,
					`Call autotask_${resource} with operation 'getMany' using filter_field/filter_value (or filtersJson) to narrow records by field values.`,
				),
			),
			correlationId,
		);
	}
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

	const timezone = await getConfiguredTimezone.call(callContext);

	// Bound to the per-call derivative: the override is not installed yet, so
	// this captures the base n8n getter (reached via the prototype chain) for
	// the keys the flat-param override delegates to.
	const originalGetNodeParameter = callContext.getNodeParameter.bind(callContext);
	const readFields = metadata.readFields ?? [];
	const writeFields = metadata.writeFields ?? [];
	const fieldValues = buildFieldValues(params, ['id'], writeFields);
	let filters: ToolFilter[];
	try {
		filters = buildFilterFromParams(params, readFields, timezone, resource);
	} catch (err) {
		if (err instanceof EmptyFilterValueError) {
			// S4: render the typed empty-value error as the standard flat envelope.
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						normalisedOperation,
						ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
						`filter_value is empty for field '${err.field}' — supply a value, or use op exist/notExist for presence checks.`,
						`Retry autotask_${resource} with operation '${normalisedOperation}' providing a non-empty filter_value for field '${err.field}', or use filter_op 'exist' or 'notExist' to check field presence.`,
						{ filterField: err.field, filterOp: err.op },
					),
				),
				correlationId,
			);
		}
		throw err;
	}
	// Promote top-level read fields (e.g. parent-scope companyID on a child resource)
	// into eq filters for generic list ops. Without this they are silently dropped for
	// reads (the query body is built from combinedFilters, not fieldValues) and the leak
	// check below would reject them. Runs before resolveAndClassifyFilters so promoted
	// filters get label resolution and flow into combinedFilters; deletes the promoted
	// keys from fieldValues so the leak check only sees genuine write-only leftovers.
	if (['getMany', 'count', 'getPosted', 'getUnposted'].includes(normalisedOperation)) {
		filters.push(...promoteReadFieldsToFilters(fieldValues, readFields));
	}
	const entityId = params.id !== undefined ? String(params.id) : '';

	const {
		resolutions: filterResolutions,
		warnings: filterWarnings,
		pendingConfirmations: filterPendingConfirmations,
		unresolvedIdLikeFilters,
		unresolvedIdLikeFilterDetails,
		unresolvedPicklistFilters,
		unresolvedPicklistFilterDetails,
	} = await resolveAndClassifyFilters(
		callContext,
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
	const selectedColumns = resolveVirtualLabelFields(
		parseFieldsParam(params.fields),
		readFields,
	);
	const selectedSlaTicketColumns = resolveVirtualLabelFields(
		parseFieldsParam(params.ticketFields),
		readFields,
	);
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
				callContext as unknown as ILoadOptionsFunctions,
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
				callContext as unknown as ILoadOptionsFunctions,
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

	const effectiveReturnAll = toBool(params.returnAll) || isShortWindow;
	const autoReturnAll = isShortWindow && !toBool(params.returnAll);

	 
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
			if (Array.isArray(parsed)) {
				parsedFiltersJson = parsed as any[];
			} else if (
				typeof parsed === 'object' &&
				parsed !== null &&
				'op' in (parsed as Record<string, unknown>) &&
				Array.isArray((parsed as Record<string, unknown>).items)
			) {
				// Documented nested form: a single top-level {op:'and'|'or', items:[...]} group —
				// the same group shape the flat filter path emits for filter_logic='or', which the
				// API accepts. Enables 3+-condition OR/AND beyond the two named filter slots.
				const group = parsed as Record<string, unknown>;
				if (group.op !== 'and' && group.op !== 'or') {
					throw new Error(`filtersJson group 'op' must be 'and' or 'or' (got '${String(group.op)}').`);
				}
				for (const item of group.items as unknown[]) {
					if (typeof item !== 'object' || item === null || !('op' in (item as object))) {
						throw new Error('filtersJson group: every item must have at minimum an "op" property.');
					}
				}
				parsedFiltersJson = [group as any];
			} else {
				throw new Error('filtersJson must be a JSON array of conditions, or a single {"op":"and"|"or","items":[...]} group.');
			}
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
		// v2.29.0 (Codex F2 on PR #148): a leaf whose 'field' key holds a
		// non-string or empty value (e.g. {"field":null,"op":"eq","value":"Open"})
		// passes the op-only checks above and would crash
		// resolveAndClassifyFilters' .toLowerCase() call sites (outside its
		// per-resolution try/catch) as a raw thrown tool failure. Reject such
		// leaves at this validation step with the standard filter-constraint
		// envelope, naming the malformed leaf.
		let malformedJsonLeaf: string | null = null;
		const checkJsonLeafFields = (node: unknown): void => {
			if (malformedJsonLeaf !== null) return;
			if (typeof node !== 'object' || node === null) return;
			const obj = node as Record<string, unknown>;
			if ('field' in obj) {
				const field = obj.field;
				if (typeof field !== 'string' || field.trim() === '') {
					malformedJsonLeaf = JSON.stringify(obj).slice(0, 200);
					return;
				}
			}
			if (Array.isArray(obj.items)) {
				for (const it of obj.items) {
					checkJsonLeafFields(it);
				}
			}
		};
		for (const el of parsedFiltersJson) {
			checkJsonLeafFields(el);
		}
		if (malformedJsonLeaf !== null) {
			return attachCorrelation(
				JSON.stringify(
					formatFilterConstraintError(
						resource,
						normalisedOperation,
						`filtersJson validation error: every leaf condition needs a non-empty string 'field' (malformed leaf: ${malformedJsonLeaf}).`,
						'Fix the malformed filtersJson leaf: "field" must be a non-empty string field name (e.g. {"field":"status","op":"eq","value":5}).',
					),
				),
				correlationId,
			);
		}
		// v2.29.0 (X16): filtersJson conditions bypassed the flat path's label
		// resolution (resolveAndClassifyFilters only sees filters built from the
		// filter_field slots), so picklist/reference labels in filtersJson were sent
		// raw and the API rejected them ("Conversion failed when converting the
		// varchar value ... to data <field> int"). Resolve the leaf conditions in
		// place (group items included — same object references flow into
		// combinedFilters) and merge the outcome into the shared accumulators so
		// resolvedLabels/warnings/pendingConfirmations and the unresolved-filter
		// guards behave identically for both parameter styles.
		if (readFields.length > 0) {
			const jsonLeaves: ToolFilter[] = [];
			// v2.29.0 (m5): the filter validator accepts arbitrary nesting (groups
			// inside groups), so walk every object whose items is an array and collect
			// every leaf that has a field at any depth. The collected objects are the
			// same references that flow into combinedFilters — resolution mutates them
			// in place.
			const collectJsonLeaves = (node: unknown): void => {
				if (typeof node !== 'object' || node === null) return;
				const obj = node as Record<string, unknown>;
				// Only leaves with a usable field name reach resolution — a
				// non-string/empty 'field' was already rejected at the validation
				// step above (Codex F2 on PR #148).
				if ('field' in obj && typeof obj.field === 'string' && (obj.field as string).trim() !== '') {
					jsonLeaves.push(obj as unknown as ToolFilter);
				}
				if (Array.isArray(obj.items)) {
					for (const it of obj.items) {
						collectJsonLeaves(it);
					}
				}
			};
			for (const el of parsedFiltersJson as unknown as Array<Record<string, unknown>>) {
				collectJsonLeaves(el);
			}
			if (jsonLeaves.length > 0) {
				const jsonResolution = await resolveAndClassifyFilters(
					callContext,
					resource,
					jsonLeaves,
					readFields,
					params as IDataObject,
				);
				filterResolutions.push(...jsonResolution.resolutions);
				filterWarnings.push(...jsonResolution.warnings);
				filterPendingConfirmations.push(...jsonResolution.pendingConfirmations);
				unresolvedIdLikeFilters.push(...jsonResolution.unresolvedIdLikeFilters);
				unresolvedIdLikeFilterDetails.push(...jsonResolution.unresolvedIdLikeFilterDetails);
				unresolvedPicklistFilters.push(...jsonResolution.unresolvedPicklistFilters);
				unresolvedPicklistFilterDetails.push(...jsonResolution.unresolvedPicklistFilterDetails);
			}
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
	// Auto-exclude terminal statuses for getMany/count on ticket/task/project unless explicitly disabled.
	// AND-appended on top of filtersJson too (same as recency above) — excludeTerminalStatuses=false opts out.
	if (
		['getMany', 'count', 'getPosted', 'getUnposted'].includes(normalisedOperation) &&
		toBool(params.excludeTerminalStatuses, true)
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
		const hasResolved = filterResolutions.length > 0;
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

		const resolvedText = filterResolutions
			.map((r) => `${r.field}: ${String(r.from)}→${String(r.to)}`)
			.join(', ');
		const pendingText = filterPendingConfirmations
			.map((pc) => `${pc.label} (${pc.candidates.length} candidates)`)
			.join(', ');

		let nextAction: string;
		if (hasResolved && hasPendingCandidates) {
			nextAction = `Resolved: ${resolvedText}. Pending: ${pendingText} — pick IDs from pendingConfirmations, then retry with all numeric IDs.`;
		} else if (hasPendingCandidates) {
			nextAction = `Candidates were found during resolution. Review pendingConfirmations from this response, choose the correct numeric ID, then retry autotask_${resource} with numeric ID filter values.`;
		} else {
			nextAction = `Use autotask_${resource} with operation 'getMany' to resolve names to numeric IDs, then retry autotask_${resource} with numeric ID filter values.`;
		}

		const resolvedElements = hasResolved
			? filterResolutions.map((r) => ({ field: r.field, label: r.from, id: r.to }))
			: undefined;

		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					`One or more ID-like filters are unresolved and still non-numeric: ${unresolvedSummary}.`,
					nextAction,
					{
						unresolvedFilters: unresolvedIdLikeFilters,
						unresolvedFilterDetails: unresolvedIdLikeFilterDetails,
						...(hasPendingCandidates
							? {
									pendingConfirmations: filterPendingConfirmations,
									pendingSummary,
								}
							: {}),
						...(resolvedElements ? { resolvedElements } : {}),
					},
				),
			),
			correlationId,
		);
	}

	if (unresolvedPicklistFilters.length > 0) {
		const summary = unresolvedPicklistFilterDetails
			.map((d) => {
				const avail = d.availableValues.length > 0 ? d.availableValues.join(', ') : 'none';
				return `'${d.field}'='${d.attemptedValue}' — available: ${avail}`;
			})
			.join('; ');
		const hasPicklistCandidates = filterPendingConfirmations.length > 0;
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_FILTER_CONSTRAINT,
					`Picklist filter value(s) not found: ${summary}.`,
					hasPicklistCandidates
						? `Partial match candidates found — pick the correct ID from pendingConfirmations, then retry autotask_${resource} with the numeric ID.`
						: `Retry autotask_${resource} using one of the listed available labels or the corresponding numeric ID for each picklist field.`,
					{
						unresolvedPicklistFilters: unresolvedPicklistFilterDetails,
						...(hasPicklistCandidates ? { pendingConfirmations: filterPendingConfirmations } : {}),
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

		// Suppress "requires filter_value" when the field is already a value-bearing filter
		// (e.g. a top-level param promoted to an eq filter above) — see isFilterFieldCovered.
		if (hasFiltersJson && (hasFlatFilter1 || hasFlatFilter2)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow mixing 'filtersJson' with flat filter fields.`);
		}
		const isNullCheckOp1 = ['exist', 'notexist'].includes(String(p.filter_op ?? '').toLowerCase());
		const filterField1Covered =
			hasProvidedValue(p.filter_field) && isFilterFieldCovered(String(p.filter_field), filters);
		if (hasProvidedValue(p.filter_field) && !hasProvidedValue(p.filter_value) && !isNullCheckOp1 && !filterField1Covered) {
			filterErrors.push(`Operation '${effectiveOperation}' requires 'filter_value' when 'filter_field' is provided (not needed when filter_op is 'exist' or 'notExist').`);
		}
		if (!hasProvidedValue(p.filter_field) && hasProvidedValue(p.filter_value)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow 'filter_value' without 'filter_field'.`);
		}
		if (hasFlatFilter2) {
			const hasFilter2Field = hasProvidedValue(p.filter_field_2);
			const hasFilter2Value = hasProvidedValue(p.filter_value_2);
			const isNullCheckOp2 = ['exist', 'notexist'].includes(String(p.filter_op_2 ?? '').toLowerCase());
			const filterField2Covered =
				hasFilter2Field && isFilterFieldCovered(String(p.filter_field_2), filters);
			if (!hasFilter2Field || (!hasFilter2Value && !isNullCheckOp2 && !filterField2Covered)) {
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

		// Detect write-field leak: bot may pass a writable field (e.g. companyID) at
		// top level expecting it to filter, but for read ops filters MUST go via
		// filter_field/filter_value or filtersJson. Without this check the field falls
		// through to the query body causing Autotask to error with confusing messages
		// like "Unable to find limit in the <Entity>".
		// Scoped to the generic list ops only — convenience ops (getByCompanyAndStatus,
		// getByAge, searchByKeyword, getUnassigned, getBySLAStatus) take operation-specific
		// params at top level by design and are handled by their own dispatchers.
		const isGenericListLeakCheckOp = ['getMany', 'count', 'getPosted', 'getUnposted'].includes(
			effectiveOperation,
		);
		if (
			isGenericListLeakCheckOp &&
			Object.keys(fieldValues).length > 0
		) {
			const leakedFields = Object.keys(fieldValues);
			const firstField = leakedFields[0];
			const firstValue = String(fieldValues[firstField]);
			const hasAnyFilter = hasFiltersJson || hasFlatFilter1 || hasFlatFilter2;
			if (hasAnyFilter) {
				const filter2Hint = !hasFlatFilter2
					? ` To filter by ${firstField}, add it to the second filter slot: filter_field_2='${firstField}', filter_op_2='eq', filter_value_2='${firstValue}'.`
					: ` Use filtersJson to include ${firstField} alongside existing filters.`;
				filterErrors.push(
					`Operation '${effectiveOperation}' received entity fields (${leakedFields.join(', ')}) as top-level params alongside filter params. Entity fields must be passed via filter slots, not directly. Remove the top-level fields.${filter2Hint}`,
				);
			} else {
				filterErrors.push(
					`Operation '${effectiveOperation}' received entity fields (${leakedFields.join(', ')}) as top-level params without any filter. Entity fields must be passed via filter slots. Use filter_field='${firstField}', filter_op='eq', filter_value='${firstValue}' (or filtersJson for advanced filters).`,
				);
			}
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

	// v2.29.0 (Codex P1 on PR #148): contact deletion is only exposed by the API on
	// the company-scoped path (DELETE Companies/{companyID}/Contacts/{id}). Without
	// companyID the executor would fall back to a flat endpoint that Autotask rejects.
	if (resource === 'contact' && effectiveOperation === 'delete' && !hasProvidedValue(params.companyID)) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					'delete',
					ERROR_TYPES.MISSING_REQUIRED_FIELDS,
					'Deleting a contact requires companyID — the Autotask API only exposes contact deletion via the company-scoped path (Companies/{companyID}/Contacts/{id}).',
					`Retry autotask_contact with operation 'delete' supplying id and companyID (numeric ID or company name, auto-resolved). If the contact's company is unknown, call autotask_contact with operation 'get' using the contact id and read companyID.`,
				),
			),
			correlationId,
		);
	}

	// v2.29.0 (m4): CIRI deletion is only exposed by the API on the CI-scoped path
	// (DELETE ConfigurationItems/{configurationItemID}/RelatedItems/{id}). Without
	// configurationItemID the executor would fall back to a flat endpoint that
	// Autotask rejects.
	if (
		resource === 'configurationItemRelatedItem'
		&& effectiveOperation === 'delete'
		&& !hasProvidedValue(params.configurationItemID)
	) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					'delete',
					ERROR_TYPES.MISSING_REQUIRED_FIELDS,
					'Delete a configuration item related item requires the parent configurationItemID (numeric ID or CI name)',
					"supply configurationItemID (a numeric configuration item ID or its name) — run autotask_configurationItemRelatedItem with operation 'describeFields' if unsure",
					{ missingFields: ['configurationItemID'] },
				),
			),
			correlationId,
		);
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

	// v2.29.x (X11 ordering fix): companyNote.create parity defaults must exist
	// BEFORE the required-field validation below, or a minimal create
	// (note + companyID) is rejected here before the defaults run. The three
	// unconditional defaults are set now (notes kept for the warnings block);
	// assignedResourceID is derived AFTER this point (impersonation / company-
	// owner probes), so it is sentinel-exempted from the required check — if no
	// usable resource can be derived, the X11 block warns and the API's own
	// missing-field error surfaces.
	const x11PreDefaults: string[] = [];
	if (resource === 'companyNote' && effectiveOperation === 'create') {
		const x11NowIso = new Date().toISOString();
		if (fieldValues.actionType === undefined) {
			fieldValues.actionType = 3; // 'Note: General'
			x11PreDefaults.push("companyNote.create: actionType defaulted to 3 ('Note: General')");
		}
		if (fieldValues.startDateTime === undefined) {
			fieldValues.startDateTime = x11NowIso;
			x11PreDefaults.push(`companyNote.create: startDateTime defaulted to ${x11NowIso}`);
		}
		if (fieldValues.endDateTime === undefined) {
			fieldValues.endDateTime = x11NowIso;
			x11PreDefaults.push(`companyNote.create: endDateTime defaulted to ${x11NowIso}`);
		}
	}
	if (['create', 'update', 'createIfNotExists'].includes(effectiveOperation)) {
		const writeValidationInput =
			resource === 'companyNote'
			&& effectiveOperation === 'create'
			&& fieldValues.assignedResourceID === undefined
				? { ...fieldValues, assignedResourceID: 0 }
				: fieldValues;
		const writeValidation = validateWriteFields(
			writeValidationInput,
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
	// v2.29.0 (Codex P1 on PR #148): include delete so a company name supplied as
	// companyID on a contact delete is resolved to a numeric ID (the company-scoped
	// delete endpoint requires the numeric parent company). The same gate covers
	// configurationItemRelatedItem deletes: a CI name supplied as configurationItemID
	// is resolved via the reference field in the create metadata (the CI-scoped
	// delete endpoint requires the numeric parent CI).

	if (
		['create', 'update', 'createIfNotExists', 'delete'].includes(effectiveOperation) &&
		Object.keys(fieldValues).length > 0
	) {
		try {
			const resolution = await resolveLabelsToIds(
				callContext,
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

	// x5: a company/CI name that failed to resolve above stays as the raw label
	// string in fieldValues — dispatching that to the parent-scoped delete
	// endpoint (e.g. Companies/{name}/Contacts/{id}) sends a doomed request.
	// Fail closed with a specific error instead of a raw API rejection.
	if (effectiveOperation === 'delete') {
		if (
			resource === 'contact' &&
			fieldValues.companyID !== undefined &&
			!isLikelyId(fieldValues.companyID)
		) {
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						'delete',
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`companyID '${String(fieldValues.companyID)}' could not be resolved to a numeric company ID.`,
						`Supply a numeric companyID, an exact company name, or call autotask_contact with operation 'get' using the contact id to read the correct companyID, then retry autotask_contact with operation 'delete'.`,
						{
							...(labelPendingConfirmations.length > 0
								? { pendingConfirmations: labelPendingConfirmations }
								: {}),
							...(labelWarnings.length > 0 ? { warnings: labelWarnings } : {}),
						},
					),
				),
				correlationId,
			);
		}
		if (
			resource === 'configurationItemRelatedItem' &&
			fieldValues.configurationItemID !== undefined &&
			!isLikelyId(fieldValues.configurationItemID)
		) {
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						'delete',
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`configurationItemID '${String(fieldValues.configurationItemID)}' could not be resolved to a numeric configuration item ID.`,
						`Supply a numeric configurationItemID or an exact configuration item name, then retry autotask_configurationItemRelatedItem with operation 'delete'.`,
						{
							...(labelPendingConfirmations.length > 0
								? { pendingConfirmations: labelPendingConfirmations }
								: {}),
							...(labelWarnings.length > 0 ? { warnings: labelWarnings } : {}),
						},
					),
				),
				correlationId,
			);
		}
	}

	// Parse userDefinedFields JSON string → [{name, value}] array and inject into fieldValues.
	// buildFieldValues excludes userDefinedFields (raw JSON string must not reach API).
	// This runs after label resolution — UDF values are passed raw (no label resolution for UDFs).
	if (
		['create', 'update', 'createIfNotExists'].includes(effectiveOperation) &&
		params.userDefinedFields !== undefined &&
		params.userDefinedFields !== null &&
		params.userDefinedFields !== ''
	) {
		try {
			const rawUdf = typeof params.userDefinedFields === 'string'
				? params.userDefinedFields
				: JSON.stringify(params.userDefinedFields);
			const parsed = JSON.parse(rawUdf) as Record<string, unknown>;
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				const udfArray = Object.entries(parsed)
					.filter(([, v]) => v !== undefined && v !== null && v !== '')
					.map(([name, value]) => ({ name, value: String(value) }));
				if (udfArray.length > 0) {
					fieldValues.userDefinedFields = udfArray;
				}
			} else {
				labelWarnings.push('userDefinedFields must be a JSON object (e.g. {"Field Name": "value"}). Provided value ignored.');
			}
		} catch {
			labelWarnings.push('userDefinedFields is not valid JSON. Provide a JSON object like {"Field Name": "value"}. UDF values were not set.');
		}
	}

	// x4 (Codex P2e): per-call impersonation guard. The unified schema exposes
	// impersonationResourceId when the resource's operation SET contains an
	// impersonation-capable op (for 'resource': transferOwnership), but
	// resource.update targets /Resources/, which the endpoint gate treats as
	// unsupported and SILENTLY drops the parameter — a successful response
	// would then falsely imply the requested attribution was applied. Reject
	// per call instead of letting it be dropped. transferOwnership is exempt:
	// its reassignment sub-calls (Companies/Tickets/Tasks/...) are on
	// supported segments.
	if (
		params.impersonationResourceId !== undefined &&
		params.impersonationResourceId !== null &&
		params.impersonationResourceId !== '' &&
		!operationSupportsImpersonation(resource, effectiveOperation)
	) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					effectiveOperation,
					ERROR_TYPES.INVALID_WRITE_FIELDS,
					`impersonationResourceId is not supported for ${resource}.${effectiveOperation} — the Autotask API does not support impersonation on that endpoint, and passing it there is silently ignored while the call still succeeds.`,
					`Remove impersonationResourceId (and proceedWithoutImpersonationIfDenied) and retry autotask_${resource} with operation '${effectiveOperation}', or use operation 'transferOwnership' which forwards it to the reassignment calls.`,
					{ providedValue: String(params.impersonationResourceId) },
				),
			),
			correlationId,
		);
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
					callContext as unknown as import('n8n-workflow').ILoadOptionsFunctions,
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
	// F6 fix: moveToCompany destinationCompanyId accepts a company NAME label (schema is
	// coerce.string, matching the node's reference-field convention). Numeric values pass
	// through unchanged; name labels resolve to a numeric company ID before the resource
	// executor's parseRequiredPositiveInt gate. Unmatched/failed resolution fails closed.
	if (effectiveOperation === 'moveToCompany') {
		const rawDestCompany = params.destinationCompanyId;
		if (typeof rawDestCompany === 'number') {
			(params as Record<string, unknown>).destinationCompanyId = String(rawDestCompany);
		} else if (typeof rawDestCompany === 'string' && rawDestCompany.trim() === '') {
			// Round-3: a whitespace-only destination is neither an ID nor a name — fail
			// closed with a clean envelope (previously it flowed to the resource
			// executor and failed in the positive-integer gate with a confusing message).
			return attachCorrelation(
				JSON.stringify(
					wrapError(
						resource,
						'moveToCompany',
						ERROR_TYPES.MISSING_REQUIRED_FIELDS,
						"'destinationCompanyId' is empty (whitespace only) — it must be a numeric company ID or an exact company name.",
						"Call autotask_contact with operation 'moveToCompany' providing destinationCompanyId as a numeric company ID or an exact company name.",
					),
				),
				correlationId,
			);
		} else if (typeof rawDestCompany === 'string' && rawDestCompany.trim() !== '') {
			const destTrimmed = rawDestCompany.trim();
			const destIsNumericId =
				/^\d+$/.test(destTrimmed) && String(parseInt(destTrimmed, 10)) === destTrimmed;
			if (destIsNumericId) {
				(params as Record<string, unknown>).destinationCompanyId = destTrimmed;
			} else {
				try {
					const { EntityValueHelper } = await import('../helpers/entity-values/value-helper');
					const helper = new EntityValueHelper(
						callContext as unknown as import('n8n-workflow').ILoadOptionsFunctions,
						'Company',
					);
					const candidates = await helper.getValues(true);
					const label = destTrimmed.toLowerCase();
					// Codex C4: never trust the helper's active-only filter blindly — if the Company
					// field-metadata request fails, getValues(true) skips the isActive filter and the
					// payload carries no isActive field at all. In that case name-based destination
					// resolution fails closed: a company is never selected as a move destination while
					// its active state is unestablished.
					const activeFilterEstablished = candidates.length > 0 && candidates.every((c) => {
						const o = c as unknown as IDataObject;
						return o.isActive !== undefined;
					});
					const matches: Array<{ id: number; name: string }> = [];
					for (const entity of candidates) {
						const entityObj = entity as unknown as IDataObject;
						const entityId = entityObj.id as number;
						// id 0 = root account record: not a valid move destination (fails the
						// positive-integer gate downstream and would move contacts to the account root).
						if (entityId <= 0) continue;
						// Explicit per-candidate active check (Codex C4): redundant with the helper's
						// active filter on the normal path, but guards the metadata-failure path where the
						// filter is skipped. On the NAME-resolution path an inactive destination fails
						// closed: moving a contact there is almost always a mistake. Explicit numeric
						// destinations are passed through to the API untouched (the API's own semantics
						// apply to caller-chosen IDs).
						const rawActive = entityObj.isActive;
						if (rawActive !== true && rawActive !== 1) continue;
						const display = helper.getEntityDisplayName(entityObj);
						// Codex C2: collect EVERY exact-name match — a destructive contact move must
						// never silently pick the first of several same-named companies.
						if (display && display.toLowerCase() === label) {
							matches.push({ id: entityId, name: display });
						}
					}
					if (matches.length === 0) {
						return attachCorrelation(
							JSON.stringify(
								wrapError(
									resource,
									effectiveOperation,
									ERROR_TYPES.WRITE_RESOLUTION_INCOMPLETE,
									activeFilterEstablished
										? `Write blocked: No match found for field(s): 'destinationCompanyId' (company name '${destTrimmed}').`
										: `Write blocked: No verifiable active company matches '${destTrimmed}' — the companies' active state could not be established for this request, so name-based destinations are disabled.`,
									`Resolve the destination company to a numeric company ID (e.g. autotask_company with operation 'getMany'), then retry autotask_${resource} with operation 'moveToCompany'.`,
								),
							),
							correlationId,
						);
					}
					if (matches.length > 1) {
						return attachCorrelation(
							JSON.stringify(
								wrapError(
									resource,
									effectiveOperation,
									ERROR_TYPES.WRITE_RESOLUTION_INCOMPLETE,
									`Write blocked: company name '${destTrimmed}' is ambiguous — it matches ${matches.length} active companies (IDs: ${matches.map((m) => m.id).join(', ')}). A contact move must not pick a destination at random.`,
									`Retry autotask_${resource} with operation 'moveToCompany' using the numeric destinationCompanyId of the intended company (e.g. autotask_company with operation 'getMany' to look it up).`,
									{ ambiguousCandidates: matches },
								),
							),
							correlationId,
						);
					}
					const matchedId = matches[0].id;
					// Mirror into BOTH consumption paths: params (override-A default case) and
					// fieldValues (override-A 'requestData'/'fieldsToMap' cases, which override-B in
					// resources/tool/execute.ts prefers for unmapped keys). Without the fieldValues
					// mirror the resource executor reads the pre-resolution label from requestData.
					(params as Record<string, unknown>).destinationCompanyId = String(matchedId);
					if (Object.prototype.hasOwnProperty.call(fieldValues, 'destinationCompanyId')) {
						(fieldValues as Record<string, unknown>).destinationCompanyId = String(matchedId);
					}
					labelResolutions.push({
						field: 'destinationCompanyId',
						from: destTrimmed,
						to: matchedId,
						method: 'reference',
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return attachCorrelation(
						JSON.stringify(
							wrapError(
								resource,
								effectiveOperation,
								ERROR_TYPES.WRITE_RESOLUTION_INCOMPLETE,
								`Write blocked: destination company resolution failed for '${destTrimmed}': ${msg}`,
								`Provide the destination company as a numeric company ID and retry autotask_${resource} with operation 'moveToCompany'.`,
							),
						),
						correlationId,
					);
				}
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
					callContext, 'GET', `Resources/${resId}`,
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
	callContext.getNodeParameter = ((
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
			// v2.29.0 (B1): contact delete is company-scoped (DELETE
			// Companies/{companyID}/Contacts/{id}) — return the label-resolved numeric
			// company ID so the URL carries a numeric parent, not the raw company name
			// the model supplied. Non-delete ops (and deletes without a resolved value)
			// fall through to the usual params/fallback behavior.
			case 'companyID':
				if (effectiveOperation === 'delete' && fieldValues.companyID !== undefined) {
					return fieldValues.companyID;
				}
				if (Object.prototype.hasOwnProperty.call(params, 'companyID')) {
					return params.companyID;
				}
				return fallbackValue;
			// v2.29.0 (m4): CIRI delete is CI-scoped (DELETE
			// ConfigurationItems/{configurationItemID}/RelatedItems/{id}) — same pattern
			// as companyID: return the label-resolved numeric parent ID.
			case 'configurationItemID':
				if (effectiveOperation === 'delete' && fieldValues.configurationItemID !== undefined) {
					return fieldValues.configurationItemID;
				}
				if (Object.prototype.hasOwnProperty.call(params, 'configurationItemID')) {
					return params.configurationItemID;
				}
				return fallbackValue;
			case 'requestData': {
				// Read ops must NEVER use fieldValues as the query body — writable fields
				// leaking into the request cause Autotask to misinterpret them and reject
				// the query (pre-flight should already catch this; defense-in-depth here).
				const isReadOp = ['getMany', 'getPosted', 'getUnposted', 'count'].includes(effectiveOperation);
				const data: Record<string, unknown> = isReadOp
					? combinedFilters.length > 0
						? { filter: combinedFilters }
						: {}
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
					return toBool(params.includeRaw);
				}
				return fallbackValue;
			case 'summaryTextLimit':
				if (effectiveOperation === 'summary') {
					return typeof params.summaryTextLimit === 'number' ? params.summaryTextLimit : 500;
				}
				return fallbackValue;
			case 'includeChildCounts':
				if (effectiveOperation === 'summary') {
					return toBool(params.includeChildCounts);
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
	}) as typeof callContext.getNodeParameter;

	try {
		// Compound operation short-circuit: createIfNotExists bypasses the standard executor
		if (effectiveOperation === 'createIfNotExists') {
			// PR #148 SEC-3 (x3 V2): the compound handler returns BEFORE the
			// post-operation denial drain below, so drain denials accrued so far
			// into labelWarnings up front (idempotent — each drain empties the
			// token queue). The handler also receives a drain-aware view of
			// labelWarnings: compound-operations.ts spreads this array when it
			// builds the response, and the iterator trap drains any markers the
			// handler's own impersonated create/update calls (performCreate /
			// performPatch) recorded mid-flight — without this, an identity
			// substitution inside the compound flow would only reach the
			// console.warn in the finally block and stay invisible to the model.
			drainDenialWarningsInto(impersonationDenialToken, labelWarnings);
			const drainAwareLabelWarnings = new Proxy(labelWarnings, {
				get(target, prop) {
					drainDenialWarningsInto(impersonationDenialToken, target);
					return Reflect.get(target, prop);
				},
			});
			const compoundState: ExecutorState = {
				context: callContext,
				resource,
				operation: effectiveOperation,
				params,
				readFields,
				writeFields,
				fieldValues,
				combinedFilters,
				effectiveLimit,
				effectiveOffset,
				effectiveReturnAll,
				recencyResult,
				labelResolutions,
				labelWarnings: drainAwareLabelWarnings,
				labelPendingConfirmations,
				filterResolutions,
				filterWarnings,
				correlationId: correlationId ?? '',
				entityId,
				selectedColumns,
				resolvedImpersonationId,
			};
			const compoundJson = await handleCreateIfNotExists(compoundState);
			if (compoundJson !== null) {
				return compoundJson;
			}
			// Fall through to standard executor when handler returns null (no compoundResult).
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

		// Dispatch to registered special handlers
		const specialHandler = SPECIAL_HANDLERS[effectiveOperation];
		if (specialHandler) {
			// Drain unconditionally rather than trust a "this path never records markers"
			// invariant that nothing enforces — idempotent no-op if the queue is empty.
			// The handler also receives a drain-aware view of labelWarnings (same
			// pattern as the compound path above) so any impersonated call the
			// handler itself makes mid-flight still surfaces its denial marker in
			// the response instead of only the finally-block console.warn.
			drainDenialWarningsInto(impersonationDenialToken, labelWarnings);
			const drainAwareSpecialHandlerWarnings = new Proxy(labelWarnings, {
				get(target, prop) {
					drainDenialWarningsInto(impersonationDenialToken, target);
					return Reflect.get(target, prop);
				},
			});
			const executorState: ExecutorState = {
				context: callContext,
				resource,
				operation: effectiveOperation,
				params,
				readFields,
				writeFields,
				fieldValues,
				combinedFilters,
				effectiveLimit,
				effectiveOffset,
				effectiveReturnAll,
				recencyResult,
				labelResolutions,
				labelWarnings: drainAwareSpecialHandlerWarnings,
				labelPendingConfirmations,
				filterResolutions,
				filterWarnings,
				correlationId: correlationId ?? '',
				entityId,
				selectedColumns,
			};
			return specialHandler(executorState);
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
		// v2.29.0 (X11): companyNote.create parity defaults — mirror the contact
		// moveToCompany audit-note semantics (v2.28.10): the API requires actionType,
		// startDateTime, endDateTime and an API-required assignedResourceID. Default
		// them so an explicit create succeeds with minimal input; every default is
		// reported in warnings, and when no usable assigned resource can be derived
		// the model is told to supply one (never a silent skip — this is an explicit
		// create, not an audit note).
		if (resource === 'companyNote' && effectiveOperation === 'create') {
			const defaults: string[] = [...x11PreDefaults];
			// x4 (Codex P2h): if no default assignedResourceID can be derived,
			// warning-only still dispatches the create and the API's rejection
			// surfaces without this context. Track the failure and return a
			// missing-required error before dispatch instead.
			let assignedResourceDerivationFailed = false;
			let assignedResourceFailReason = '';
			if (fieldValues.assignedResourceID === undefined) {
				// A generic companyNote.create has NO temporary-activation window (unlike
				// contact moveToCompany audit notes, which run inside the mover's
				// withActiveImpersonationResource window). The active-only gate on the
				// resource IDs injected below is the safety control: an inactive ID
				// injected here would otherwise be auto-activated by the write-retry
				// machinery with only best-effort restore.
				if (hasProvidedValue(params.impersonationResourceId)) {
					const impIsNumeric = isLikelyId(params.impersonationResourceId);
					// ID that would be injected: numeric input passes through the
					// earlier resolution unchanged (no active-state check), label
					// input is the resolved numeric ID. Unresolvable label →
					// undefined → fail-closed branch below.
					const impId = impIsNumeric
						? resolvedImpersonationId ?? Number(params.impersonationResourceId)
						: resolvedImpersonationId;
					if (impId !== undefined) {
						// Explicit active probe for BOTH input kinds: numeric
						// resolution is a passthrough with no active-state check,
						// and label resolution searches active resources only
						// when the isActive metadata lookup succeeds — when it
						// fails, getValues(true) deliberately skips the active
						// filter, so a name/email label can resolve to an
						// INACTIVE resource (NOT "active by construction"). An
						// inactive ID injected here would be auto-activated by
						// the write-retry machinery with only best-effort
						// restore. (Verifier V1: the previous shape left this
						// gate unreachable because every numeric input had
						// already set resolvedImpersonationId.)
						let impIdActive: boolean | undefined;
						try {
							const impProbe = Object.create(callContext) as typeof callContext;
							impProbe.getNodeParameter = ((
								name: string,
								...args: unknown[]
							): unknown => {
								if (name === 'targetOperation') return 'resource.get';
								if (name === 'entityId') return impId;
								if (name === 'requestData') return '{}';
								return (callContext.getNodeParameter as (n: string, ...a: unknown[]) => unknown)(name, ...args);
							}) as typeof callContext.getNodeParameter;
							const impResult = await executeToolOperation.call(impProbe);
							const impRec = (impResult[0]?.[0]?.json ?? null) as Record<string, unknown> | null;
							impIdActive =
								impRec !== null
								&& (impRec.isActive === true || impRec.isActive === 1 || impRec.isActive === '1' || impRec.isActive === 'true');
						} catch (probeErr) {
							// Probe failed — active state unverifiable; fail closed.
							console.warn(
								`companyNote.create: impersonation-resource active-state probe failed for resource ${impId}:`,
								probeErr instanceof Error ? probeErr.message : String(probeErr),
							);
							impIdActive = undefined;
						}
						if (impIdActive === true) {
							fieldValues.assignedResourceID = impId;
							defaults.push(
								impIsNumeric
									? `companyNote.create: assignedResourceID defaulted to the impersonation resource ${impId} (active-verified)`
									: `companyNote.create: assignedResourceID defaulted to the impersonation resource ${impId} (resolved from '${String(params.impersonationResourceId)}', active-verified)`,
							);
						} else {
							labelWarnings.push(
								`companyNote.create: impersonation resource ${impId} is inactive (or its active state could not be verified) — the API requires an active assignedResourceID; supply a numeric active resource ID or set assignedResourceID explicitly.`,
							);
							assignedResourceDerivationFailed = true;
							assignedResourceFailReason = 'the impersonation resource is inactive (or unverifiable)';
						}
					} else {
						// Unresolvable label — fail closed: never inject the raw label.
						// (The pre-execution write guard also blocks on
						// impersonationFailed; this warning keeps the response specific
						// if that ever changes.)
						labelWarnings.push(
							`companyNote.create: impersonationResourceId '${String(params.impersonationResourceId)}' could not be resolved to a numeric resource ID — the API requires a numeric assignedResourceID; supply a numeric ID, an exact resource name, or set assignedResourceID explicitly.`,
						);
						assignedResourceDerivationFailed = true;
						assignedResourceFailReason = 'the impersonation resource could not be resolved to a numeric ID';
					}
				} else if (fieldValues.companyID !== undefined) {
					// Company's owner resource, active-only (same rule as contact-mover).
					try {
						const compProbe = Object.create(callContext) as typeof callContext;
						compProbe.getNodeParameter = ((
							name: string,
							...args: unknown[]
						): unknown => {
							if (name === 'targetOperation') return 'company.get';
							if (name === 'entityId') return fieldValues.companyID;
							if (name === 'requestData') return '{}';
							return (callContext.getNodeParameter as (n: string, ...a: unknown[]) => unknown)(name, ...args);
						}) as typeof callContext.getNodeParameter;
						const compResult = await executeToolOperation.call(compProbe);
						const company = (compResult[0]?.[0]?.json ?? null) as Record<string, unknown> | null;
						const ownerResourceID = company?.ownerResourceID;
						if (ownerResourceID !== undefined && ownerResourceID !== null && ownerResourceID !== 0) {
							const resProbe = Object.create(callContext) as typeof callContext;
							resProbe.getNodeParameter = ((
								name: string,
								...args: unknown[]
							): unknown => {
								if (name === 'targetOperation') return 'resource.get';
								if (name === 'entityId') return ownerResourceID;
								if (name === 'requestData') return '{}';
								return (callContext.getNodeParameter as (n: string, ...a: unknown[]) => unknown)(name, ...args);
							}) as typeof callContext.getNodeParameter;
							const resResult = await executeToolOperation.call(resProbe);
							const resRec = (resResult[0]?.[0]?.json ?? null) as Record<string, unknown> | null;
							const resActive =
								resRec !== null
								&& (resRec.isActive === true || resRec.isActive === 1 || resRec.isActive === '1' || resRec.isActive === 'true');
							if (resActive) {
								fieldValues.assignedResourceID = ownerResourceID;
								defaults.push(
									`companyNote.create: assignedResourceID defaulted to the company's owner resource ${ownerResourceID} (active-only)`,
								);
							} else {
								labelWarnings.push(
									`companyNote.create: no assignedResourceID supplied and company ${fieldValues.companyID} has no usable (active) owner resource — the API requires assignedResourceID; supply it explicitly.`,
								);
								assignedResourceDerivationFailed = true;
								assignedResourceFailReason = 'the company owner is missing or inactive';
							}
						} else {
							labelWarnings.push(
								`companyNote.create: company ${fieldValues.companyID} has no owner resource and no assignedResourceID was supplied — the API requires assignedResourceID; supply it explicitly.`,
							);
							assignedResourceDerivationFailed = true;
							assignedResourceFailReason = 'the company has no owner resource';
						}
					} catch (lookupErr) {
						console.warn(
							`companyNote.create: company/owner resource lookup failed for companyID ${fieldValues.companyID}:`,
							lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
						);
						labelWarnings.push(
							'companyNote.create: could not derive a default assignedResourceID (company/owner lookup failed) — supply assignedResourceID explicitly.',
						);
						assignedResourceDerivationFailed = true;
						assignedResourceFailReason = 'the company/owner lookup failed';
					}
				} else {
					labelWarnings.push(
						'companyNote.create: no assignedResourceID supplied and no companyID to derive an owner from — the API requires assignedResourceID; supply it explicitly.',
					);
					assignedResourceDerivationFailed = true;
					assignedResourceFailReason = 'no companyID was supplied to derive an owner from';
				}
			}
			if (defaults.length > 0) labelWarnings.push(...defaults);
			if (assignedResourceDerivationFailed) {
				// x4 (Codex P2h): fail closed BEFORE dispatch — the API would reject
				// the create for the missing assignedResourceID and format the raw
				// rejection without this derivation context.
				return attachCorrelation(
					JSON.stringify(
						wrapError(
							resource,
							effectiveOperation,
							ERROR_TYPES.MISSING_REQUIRED_FIELDS,
							`companyNote.create requires assignedResourceID and no default could be derived (${assignedResourceFailReason}).`,
							`Supply assignedResourceID explicitly — a numeric active resource ID, or an exact resource name/email that resolves to an active resource — and retry autotask_${resource} with operation 'create'.`,
							{ derivationWarnings: labelWarnings },
						),
					),
					correlationId,
				);
			}
		}
		const [result, parallelCountResult] = await Promise.all([
			executeToolOperation.call(callContext),
			needsParallelCount
				? executeCountOperation(resource, combinedFilters, callContext)
				: Promise.resolve<number | null>(null),
		]);
		const items = result[0] ?? [];

		// PR #148 SEC-3: impersonation-denial retries (the requested resource was
		// stripped and the request re-issued as the credential user) must be
		// visible to the model — otherwise the record is mis-attributed and the
		// substitution stays invisible in the response. Also covers the
		// compound-handler fall-through (handler returned null → standard path):
		// this is the drain that surfaces any marker it recorded.
		drainDenialWarningsInto(impersonationDenialToken, labelWarnings);
		const fetchedRecords = items.map((item) => item.json);
		// Cap lift: when sparse fields + returnAll both active, agent controls context cost.
		// Gate on effectiveReturnAll — without it, fetchedRecords is already bounded by limit.
		// Use fetchedRecords.length (not MAX_SAFE_INTEGER) so clientCap produces sensible strings downstream.
		const responsePayloadCap =
			selectedColumns.length > 0 && effectiveReturnAll ? fetchedRecords.length : MAX_RESPONSE_RECORDS;
		const returnedCount = Math.min(fetchedRecords.length, responsePayloadCap);
		const isProbablyTruncated =
			fetchedRecords.length > responsePayloadCap ||
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
			injectedCount = await executeCountOperation(resource, combinedFilters, callContext);
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
		if (selectedColumns.length > 0 && effectiveReturnAll && fetchedRecords.length > MAX_RESPONSE_RECORDS) {
			countInjectionWarnings.push(
				`${fetchedRecords.length} records returned — sparse fields + returnAll active, payload cap lifted. Use tight filters to reduce context cost if needed.`,
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
		// v2.29.0 (X15): enforce the sparse-fields contract client-side. The API's paged
		// next-URL does not reliably preserve IncludeFields (later pages can come back
		// with every field), so project every record to the requested columns — keeping
		// id (so downstream enrichment/labels keep working), any *_label variants, and
		// userDefinedFields.
		if (selectedColumns.length > 0 && supportsListProjection(effectiveOperation)) {
			// v2.29.x (m5): validateReadFields() accepts field names case-insensitively
			// (both sides lowercased), so a call may request e.g. 'Status' while the
			// API's canonical key — and the record keys it returns — is 'status'.
			// Build the keep set lowercased (plus each field's '_label' variant) and
			// test returned keys lowercased, so a requested 'status' keeps both
			// 'status' and the derived 'status_label' regardless of request casing.
			const keep = new Set<string>();
			for (const col of selectedColumns) {
				const base = col.toLowerCase();
				keep.add(base);
				keep.add(`${base}_label`);
			}
			// v2.29.x (m4): enrichment trigger fields are kept even when not
			// selected — otherwise projection strips ticketID/taskID and
			// enrichResponseJson silently stops firing. Contract: the display
			// fields enrichment ADDS are an accepted exception to the sparse
			// selection contract (documented here and in the opdoc).
			// v2.29.x (X15): keep EVERY enrichment trigger field, not just
			// ticketID/taskID — see ENRICHMENT_TRIGGER_FIELDS (must stay in sync
			// with ENRICHMENT_REGISTRY in helpers/enrichment.ts).
			for (const field of ENRICHMENT_TRIGGER_FIELDS) {
				keep.add(field);
			}
			const projected = records.map((rec) => {
				const r = rec as Record<string, unknown>;
				const out: Record<string, unknown> = {};
				for (const key of Object.keys(r)) {
					if (keep.has(key.toLowerCase()) || key === 'id' || key === 'userDefinedFields') {
						out[key] = r[key];
					}
				}
				return out;
			});
			records = projected as unknown as IDataObject[];
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
		const extraWarnings: string[] = [];
		// v2.29.0 (X6): the Autotask by-ID GET route for ConfigurationItemRelatedItem
		// does not resolve the ID returned by create (API-side inconsistency; getMany
		// DOES find the record). Warn on mutations so the model doesn't loop on get.
		if (
			resource === 'configurationItemRelatedItem'
			&& (effectiveOperation === 'create' || effectiveOperation === 'update')
		) {
			extraWarnings.push(
				"configurationItemRelatedItem: the ID returned by this API may not resolve with operation 'get' (Autotask by-ID route inconsistency) — verify with getMany filtered by configurationItemID instead.",
			);
		}
		const mergedWarnings = [...allWarnings, ...countInjectionWarnings, ...rawDatePairWarnings, ...extraWarnings];
		const responseContext: ToolResponseContext = {
			// moveConfigurationItem takes its source from sourceConfigurationItemId,
			// not id — read both so the clone-and-deactivate summary names the real
			// source record (Codex P2 on PR #148).
			originalRecordId:
				effectiveOperation === 'moveConfigurationItem'
					? params.sourceConfigurationItemId !== undefined
						? String(params.sourceConfigurationItemId)
						: params.id !== undefined
							? String(params.id)
							: undefined
					: undefined,
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
			clientCap: responsePayloadCap,
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
			const creds = (await callContext.getCredentials('autotaskApi')) as IAutotaskCredentials;
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
		const enrichedResponse = await enrichResponseJson(formattedResponse, callContext);
		return attachCorrelation(enrichedResponse, correlationId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const isInternal =
			error instanceof TypeError
			|| error instanceof ReferenceError
			|| error instanceof RangeError;
		// Internal-error summary surfaced to the LLM is sanitised to the error class name only —
		// raw message can leak file paths or internal identifiers and the LLM is instructed
		// not to retry anyway. Full message + stack remain in the JSONL trace for operators.
		const internalSummary = isInternal && error instanceof Error
			? `Internal tool error: ${error.constructor.name}`
			: message;
		traceError({
			phase: 'execute-catch',
			resource,
			operation: effectiveOperation,
			correlationId,
			durationMs: Date.now() - startedAt,
			summary: {
				errorMessage: message,
				beforeApiCall: false,
				internal: isInternal || undefined,
				...(isInternal && error instanceof Error && error.stack
					? { stack: error.stack }
					: {}),
			},
		});
		let errorEnvelope = isInternal
			? wrapError(
				resource,
				effectiveOperation,
				ERROR_TYPES.INTERNAL_ERROR,
				internalSummary,
				'This appears to be a bug in the tool. Do not retry with the same parameters.',
			)
			: formatApiError(message, resource, effectiveOperation);
		// v2.29.0 (X2): Autotask reports a MISSING record on update/delete as a
		// permission-flavoured 403 ("…may not have the required permissions" /
		// "No matching records found"), which formatApiError classifies as
		// PERMISSION_DENIED and sends the model down a security-debugging path.
		// Confirm with a read before reporting: if the record does not exist, the
		// truthful error is ENTITY_NOT_FOUND. One extra GET, only on this rare path.
		if (
			!isInternal
			&& errorEnvelope.errorType === ERROR_TYPES.PERMISSION_DENIED
			&& (effectiveOperation === 'update' || effectiveOperation === 'delete')
			&& params.id !== undefined
		) {
			try {
				// Probe with a minimal direct API query (NOT the full executor, whose
				// parameter/override plumbing is too brittle for a side-channel probe,
				// and NOT by-ID get: Autotask returns the SAME permission-flavoured
				// 403 body for a missing record on get as on update/delete, so a by-ID
				// probe cannot distinguish 'no permission' from 'no record'). A
				// getMany-style POST filtered by id reports absence cleanly (empty
				// item list) and is unaffected by the 403 masking (Codex P2, PR #148).
				let probeEntity = entityNameForResource(resource);
				if (!getEntityMetadata(probeEntity)) {
					// Plural resource keys without a resourceKey override (e.g.
					// 'configurationItemTypes' -> 'ConfigurationItemType') are not
					// resolved by entityNameForResource — fall back to a tolerant
					// name/resourceKey match for the probe.
					const key = resource.toLowerCase();
					const cand = AUTOTASK_ENTITIES.find(
						(e) =>
							(e.resourceKey && e.resourceKey.toLowerCase() === key)
							|| e.name.toLowerCase() === key
							|| `${e.name.toLowerCase()}s` === key,
					);
					if (cand) probeEntity = cand.name;
				}
				// Numeric-strict id: send a real number when params.id is all digits
				// (string id values can be mishandled by the API's filter type
				// coercion); pass non-numeric values through as strings.
				const probeIdValue = /^\d+$/.test(String(params.id))
					? Number(params.id)
					: String(params.id);
				const probeBody = {
					filter: [{ field: 'id', op: 'eq', value: probeIdValue }],
					MaxRecords: 1,
				};
				// isQuery: true is REQUIRED — without it the same POST body is
				// interpreted by the API as a create (server-side field validation:
				// 'Missing Required Field: isActive'), which both breaks the probe
				// and risks writes. (Found via debug logging, 2026-08-29.)
				// Identity matching per operation family: the probe must run with
				// the SAME identity the failed write actually used — create/update
				// forward impersonationResourceId to their API call, but
				// DeleteOperation does NOT (its DELETE runs under the credential
				// user), so the delete probe drops impersonation; with a
				// mismatched identity an empty probe result is a permission
				// artifact, not proof of non-existence.
				const probeImpersonation =
					effectiveOperation === 'delete' ? undefined : resolvedImpersonationId;
				// x4 (Codex P2i): the probe must use the SAME identity policy as
				// the failed write. If the caller set proceedWithoutImpersonationIfDenied=false,
				// the failed write stayed under the impersonated identity — but the
				// probe would otherwise fall back to autotaskApiRequest's true
				// default, retry its read as the credential user, and an empty
				// fallback result (different line-of-business visibility) would
				// misclassify a genuine impersonation denial as ENTITY_NOT_FOUND.
				// undefined here keeps the true default (matches the write's own
				// fallback when the model passed nothing).
				// params values are loosely typed (schema coerces to boolean at parse).
				const probeProceedWithout =
					typeof params.proceedWithoutImpersonationIfDenied === 'boolean'
						? params.proceedWithoutImpersonationIfDenied
						: undefined;
				const probeResp = (await autotaskApiRequest.call(
					callContext,
					'POST',
					buildEntityUrl(probeEntity, { isQuery: true }),
					probeBody,
					{},
					probeImpersonation,
					probeProceedWithout,
				)) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null;
				const probeItems = Array.isArray(probeResp) ? probeResp : (probeResp?.items ?? []);
				// v2.29.x: the by-ID query route for configurationItemRelatedItem is
				// inconsistent (X6/F3: create-response IDs may not resolve with
				// by-ID queries), so an empty probe there proves NOTHING about
				// existence — keep the original permission envelope instead of
				// asserting ENTITY_NOT_FOUND for a record that may be visible via
				// getMany.
				if (probeItems.length === 0 && resource !== 'configurationItemRelatedItem') {
					errorEnvelope = wrapError(
						resource,
						effectiveOperation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${probeEntity} visible to this API user with id ${params.id} — it may not exist, or may be outside the API user's line of business.`,
						`If the user supplied this ID explicitly, report that no record was found with that ID (it may not exist, or may be outside the API user's permissions). Use autotask_${resource} with operation 'getMany' and a filter to locate a valid record ID.`,
					);
				}
			} catch (probeErr) {
				// Classify the probe exception: not-found/404-shaped errors confirm
				// the record is gone; a 403/permission or transport failure keeps
				// the original PERMISSION_DENIED classification (the account may
				// genuinely lack access). For configurationItemRelatedItem the
				// by-ID query route is unreliable (X6/F3), so a probe exception
				// there also proves nothing — keep the permission envelope.
				const pMsg = probeErr instanceof Error ? probeErr.message : String(probeErr);
				if (resource !== 'configurationItemRelatedItem' && /not found|no matching|notfound|\b404\b/i.test(pMsg)) {
					errorEnvelope = wrapError(
						resource,
						effectiveOperation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} visible to this API user with id ${params.id} — it may not exist, or may be outside the API user's line of business.`,
						`If the user supplied this ID explicitly, report that no record was found with that ID (it may not exist, or may be outside the API user's permissions). Use autotask_${resource} with operation 'getMany' and a filter to locate a valid record ID.`,
					);
				}
			}
		}
		return attachCorrelation(JSON.stringify(errorEnvelope), correlationId);
	} finally {
		// The base context is never mutated (the override lived on the per-call
		// derivative, x3 V7) — retiring the derivative's own property keeps the
		// discarded derivative from carrying this call's flat-param mapping.
		callContext.getNodeParameter = originalGetNodeParameter;

		// PR #148 SEC-3: clear this execution's denial-token registration and log
		// any markers not drained by the warnings path (e.g. the flow errored
		// after a denial-retry) — legacy-path behaviour (console.warn already
		// emitted by request.ts, marker logged here). The registration and this
		// cleanup both target the per-call derivative (x3 V7).
		clearImpersonationDenialToken(callContext);
		const leftoverDenials = drainImpersonationDenialMarkers(impersonationDenialToken);
		if (leftoverDenials.length > 0) {
			console.warn(
				`[executeAiTool] Impersonation denied for resource(s) ${leftoverDenials
					.map((d) => `${d.resourceId} (${d.method} ${d.endpoint})`)
					.join(', ')} on ${resource} '${effectiveOperation}'; the request(s) executed as the credential user.`,
			);
		}
	}
}
