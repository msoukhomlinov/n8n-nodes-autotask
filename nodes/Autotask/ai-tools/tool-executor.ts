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
import { TYPED_REFERENCE_COMPANION_FIELDS } from '../helpers/typed-reference';
import {
	applyChangeInfoAliases,
	buildAliasMap,
	shouldApplyAliases,
} from '../helpers/change-info-aliases';
import { buildOperationDoc } from './description-builders';
import { getIdentifierPairConfig } from '../constants/resource-operations';
import { getConfiguredTimezone, convertDatesToUTC } from '../helpers/date-time/utils';
import { buildRecencyFilters, type RecencyBuildResult } from './recency';
import {
	attachCorrelation,
	buildMetadataResponse,
	buildCompoundResponse,
	type ToolResponseContext,
} from './response-builder';
import { dispatchOperationResponse } from './operation-handlers/operation-dispatch';
import {
	buildFieldLookup,
	buildFilterFromParams,
	resolveAndClassifyFilters,
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
	[key: string]: string | number | boolean | Array<string | number | boolean> | undefined;
}

export interface ToolExecutionMetadata {
	readFields?: FieldMeta[];
	writeFields?: FieldMeta[];
	allAllowedOps?: string[];
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
		case 'getbyyear':
			return 'getByYear';
		case 'describeoperation':
			return 'describeOperation';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCompoundEntityId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.entityIdField;
	return field ? result[field] : (result.id ?? result.itemId);
}

/** Extract the canonical existing-entity numeric ID from a compound creator result (skip/update). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCompoundExistingId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.existingIdField;
	return field ? result[field] : result.existingId;
}

/** Build the context block (parent/scope fields) for a compound creator result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
	const filters = buildFilterFromParams(params, readFields, timezone);
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
		recencyResult.isActive && params.returnAll !== true
			? RECENCY_OVER_REQUEST_LIMIT
			: effectiveOffset > 0 && supportsOffsetPagination
				? Math.min(effectiveOffset + effectiveLimit, MAX_QUERY_LIMIT)
				: params.returnAll === true
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
			returnAll: params.returnAll === true,
			recencyActive: recencyResult.isActive,
			offsetIgnoredDueToRecency: recencyResult.isActive && effectiveOffset > 0,
			offsetExceedsApiCap,
			outputMode: params.outputMode ?? 'idsAndLabels',
			selectedFields: selectedColumns.length > 0 ? selectedColumns : undefined,
		},
	});

	if (supportsOffsetPagination && offsetExceedsApiCap && !params.returnAll) {
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
	const isListOperation = ['getMany', 'count', 'getPosted', 'getUnposted'].includes(effectiveOperation);
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
		if (hasProvidedValue(p.filter_field) && !hasProvidedValue(p.filter_value)) {
			filterErrors.push(`Operation '${effectiveOperation}' requires 'filter_value' when 'filter_field' is provided.`);
		}
		if (!hasProvidedValue(p.filter_field) && hasProvidedValue(p.filter_value)) {
			filterErrors.push(`Operation '${effectiveOperation}' does not allow 'filter_value' without 'filter_field'.`);
		}
		if (hasFlatFilter2) {
			const hasFilter2Field = hasProvidedValue(p.filter_field_2);
			const hasFilter2Value = hasProvidedValue(p.filter_value_2);
			if (!hasFilter2Field || !hasFilter2Value) {
				filterErrors.push(
					`Operation '${effectiveOperation}' requires both 'filter_field_2' and 'filter_value_2' when using a second filter.`,
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
		['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain'].includes(
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
				if (effectiveOperation === 'searchByDomain') {
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
				return params.returnAll === true;
			case 'maxRecords':
				return params.returnAll === true || queryLimit === undefined
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

				return attachCorrelation(
					JSON.stringify(
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
					),
					correlationId,
				);
			}
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
		const result = await executeToolOperation.call(context);
		const items = result[0] ?? [];
		const fetchedRecords = items.map((item) => item.json);
		let records = fetchedRecords;
		const supportsListResponse = ['getMany', 'getPosted', 'getUnposted'].includes(
			effectiveOperation,
		);
		// Recency takes priority: reverse-sort by date and take first N. Offset is not
		// compatible with recency (recency re-sorts the full window), so ignore offset here.
		// returnAll bypasses the effectiveLimit cap — return all records in the recency window.
		if (recencyResult.isActive && supportsListResponse) {
			const recencySliceLimit = params.returnAll ? fetchedRecords.length : effectiveLimit;
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
		const responseContext: ToolResponseContext = {
			recencyActive: recencyResult.isActive,
			recencyNote: recencyResult.note ?? recencyOffsetNote,
			recencyWindowLimited:
				recencyResult.isActive &&
				params.returnAll !== true &&
				supportsListResponse &&
				fetchedRecords.length >= RECENCY_OVER_REQUEST_LIMIT,
			resolutions: allResolutions.length > 0 ? allResolutions : undefined,
			resolutionWarnings: allWarnings.length > 0 ? allWarnings : undefined,
			pendingConfirmations:
				allPendingConfirmations.length > 0 ? allPendingConfirmations : undefined,
			effectiveOffset: recencyResult.isActive ? 0 : effectiveOffset,
			readFields,
			serverCap: queryLimit ?? MAX_QUERY_LIMIT,
			clientCap: 100,
			serverCapReached: Boolean(
				supportsListResponse &&
				queryLimit !== undefined &&
				recencyResult.isActive &&
				fetchedRecords.length >= queryLimit,
			),
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
		return attachCorrelation(formattedResponse, correlationId);
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
