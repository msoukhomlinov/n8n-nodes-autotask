import { wrapError, ERROR_TYPES } from '../error-formatter';
import {
	buildListResponse,
	buildItemResponse,
	buildMutationResponse,
	buildDeleteResponse,
	buildCountResponse,
	buildSlaHealthCheckResponse,
	buildTicketSummaryResponse,
	toResolvedLabels,
	computeListContinuation,
	type ToolResponseContext,
	type ListPaginationState,
} from '../response-builder';
import { MAX_QUERY_LIMIT, getEffectiveLimit } from '../tool-executor';
import { getOperationMetadata } from '../operation-metadata';

const MAX_RESPONSE_RECORDS = 100;

interface OperationResponseParams {
	id?: number;
	ticketNumber?: string;
	resourceID?: string | number;
	year?: string | number;
	limit?: number;
	returnAll?: boolean;
	filtersJson?: string;
	filter_field?: string;
	filter_op?: string;
	filter_value?: string | number | boolean | Array<string | number | boolean>;
	filter_field_2?: string;
	filter_op_2?: string;
	filter_value_2?: string | number | boolean | Array<string | number | boolean>;
	filter_logic?: 'and' | 'or';
	recency?: string;
	since?: string;
	until?: string;
}

interface MutationValidationResult {
	ok: boolean;
	id?: number | string;
	errorType?: string;
	message?: string;
	hint?: string;
}

export function dispatchOperationResponse(
	resource: string,
	operation: string,
	records: Record<string, unknown>[],
	params: OperationResponseParams,
	context: ToolResponseContext = {},
): string {
	const firstRecord = records[0] ?? null;
	const responseKind = getOperationMetadata(operation)?.responseKind;

	const extractId = (record: Record<string, unknown> | null): number | string | null => {
		if (!record) return null;
		const candidate = record.itemId ?? record.id;
		return typeof candidate === 'number' || typeof candidate === 'string' ? candidate : null;
	};
	const isEmptyObjectRecord = (record: Record<string, unknown> | null): boolean =>
		record !== null && !Array.isArray(record) && Object.keys(record).length === 0;

	const validateMutationSuccess = (
		op: string,
		record: Record<string, unknown> | null,
	): MutationValidationResult => {
		const recordId = extractId(record);
		switch (op) {
			case 'create': {
				if (recordId !== null) return { ok: true, id: recordId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `Create ${resource} did not return a created entity ID.`,
					hint: `Retry autotask_${resource} with operation 'create'. If it persists, inspect API response shape for ${resource}.create.`,
				};
			}
			case 'update': {
				const fallbackId = params.id;
				if (recordId !== null) return { ok: true, id: recordId };
				if (fallbackId !== undefined && fallbackId !== null) return { ok: true, id: fallbackId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `Update ${resource} succeeded but no target ID could be confirmed.`,
					hint: `Call autotask_${resource} with operation 'update' and include a numeric 'id'.`,
				};
			}
			case 'approve':
			case 'reject': {
				const fallbackId = params.id;
				if (recordId !== null) return { ok: true, id: recordId };
				if (isEmptyObjectRecord(record) || record?.success === true) {
					if (fallbackId !== undefined && fallbackId !== null) {
						return { ok: true, id: fallbackId };
					}
				}
				if (record === null || record === undefined) {
					return {
						ok: false,
						errorType: ERROR_TYPES.ENTITY_NOT_FOUND,
						message: `No ${resource} found with id ${fallbackId ?? 'unknown'}.`,
						hint: `Use autotask_${resource} with operation 'getMany' to locate a valid record, then retry ${op}.`,
					};
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `${op === 'approve' ? 'Approve' : 'Reject'} ${resource} returned an unverifiable success payload.`,
					hint: `Call autotask_${resource} with operation '${op}' and include a numeric 'id'.`,
				};
			}
			case 'moveToCompany': {
				const movedId = record?.newContactId;
				if (typeof movedId === 'number' && movedId > 0) return { ok: true, id: movedId };
				const sourceContactId = record?.sourceContactId;
				const markedSuccess = record?.success === true;
				const isDryRun = record?.dryRun === true;
				const isSkipped = record?.skipped === true;
				if (
					markedSuccess &&
					(isDryRun || isSkipped) &&
					typeof sourceContactId === 'number' &&
					sourceContactId > 0
				) {
					return { ok: true, id: sourceContactId };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `moveToCompany did not return 'newContactId'.`,
					hint: `Retry the move, then verify contact-mover output includes 'newContactId' (or sourceContactId for dry run/skip).`,
				};
			}
			case 'moveConfigurationItem': {
				const movedId = record?.newConfigurationItemId;
				if (typeof movedId === 'number' && movedId > 0) return { ok: true, id: movedId };
				const runId = record?.runId;
				if (record?.dryRun === true && typeof runId === 'string' && runId.trim() !== '') {
					return { ok: true, id: runId };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `moveConfigurationItem did not return 'newConfigurationItemId'.`,
					hint: `Retry the move, then verify migration output includes 'newConfigurationItemId' (or runId for dry run).`,
				};
			}
			case 'transferOwnership': {
				const runId = record?.runId;
				const summaryCounts = record?.summaryCounts;
				if (typeof runId === 'string' && runId.trim() !== '' && summaryCounts !== undefined) {
					return { ok: true, id: runId };
				}
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `transferOwnership did not return expected run summary fields (runId, summaryCounts).`,
					hint: `Retry transferOwnership and inspect work-reassigner response integrity.`,
				};
			}
			default: {
				if (recordId !== null) return { ok: true, id: recordId };
				return {
					ok: false,
					errorType: ERROR_TYPES.API_ERROR,
					message: `${resource}.${op} returned an unsupported mutation response shape.`,
					hint: `Use a supported mutation operation for autotask_${resource}.`,
				};
			}
		}
	};

	if (responseKind === 'list' && operation !== 'searchByDomain') {
		const hasFilters = !!(
			params.filter_field ||
			params.filter_field_2 ||
			params.filtersJson ||
			params.recency ||
			params.since ||
			params.until
		);
		if (hasFilters && records.length === 0) {
			const filtersUsed: Record<string, unknown> = {};
			if (params.filter_field) {
				filtersUsed.filter_field = params.filter_field;
				filtersUsed.filter_op = params.filter_op;
				filtersUsed.filter_value = params.filter_value;
			}
			if (params.filter_field_2) {
				filtersUsed.filter_field_2 = params.filter_field_2;
				filtersUsed.filter_op_2 = params.filter_op_2;
				filtersUsed.filter_value_2 = params.filter_value_2;
			}
			if (params.filter_logic && params.filter_logic !== 'and') {
				filtersUsed.filter_logic = params.filter_logic;
			}
			if (params.filtersJson) filtersUsed.filtersJson = params.filtersJson;
			if (params.recency) filtersUsed.recency = params.recency;
			if (params.since) filtersUsed.since = params.since;
			if (params.until) filtersUsed.until = params.until;

			const usedFilterFields = new Set<string>(
				[
					typeof params.filter_field === 'string' ? params.filter_field : '',
					typeof params.filter_field_2 === 'string' ? params.filter_field_2 : '',
				]
					.map((f) => f.trim().toLowerCase())
					.filter((f) => f !== ''),
			);
			const alternativeFilterFields = (context.readFields ?? [])
				.filter(
					(f) =>
						!f.udf &&
						typeof f.type === 'string' &&
						f.type.toLowerCase() === 'string' &&
						!usedFilterFields.has(f.id.toLowerCase()),
				)
				.map((f) => f.id)
				.slice(0, 10);

			const contextFields: Record<string, unknown> = { filtersUsed };
			if (alternativeFilterFields.length > 0) {
				contextFields.alternativeFilterFields = alternativeFilterFields;
			}
			const unresolvedFilterWarnings = context.resolutionWarnings ?? [];
			if (unresolvedFilterWarnings.length > 0) {
				contextFields.filterResolutionWarnings = unresolvedFilterWarnings;
			}
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					ERROR_TYPES.NO_RESULTS_FOUND,
					`No ${resource} records matched the supplied filters.`,
					`Definitive negative — do not retry with the same filters. Broaden or change filter_field/filter_value and retry.`,
					contextFields,
				),
			);
		}

		const total = records.length;
		const truncated = total > MAX_RESPONSE_RECORDS;
		const items = truncated ? records.slice(0, MAX_RESPONSE_RECORDS) : records;
		const currentOffset = context.effectiveOffset ?? 0;
		let totalAvailable: number | undefined;
		const continuationContract = computeListContinuation({
			currentOffset,
			recordsReturned: items.length,
			recordsMatched: total,
			requestedLimit: getEffectiveLimit(params.limit),
			returnAll: params.returnAll === true,
			recencyActive: context.recencyActive === true,
			maxQueryLimit: MAX_QUERY_LIMIT,
			serverCap: context.serverCap ?? MAX_QUERY_LIMIT,
			clientCap: context.clientCap ?? MAX_RESPONSE_RECORDS,
			serverCapReached:
				context.serverCapReached === true || context.recencyWindowLimited === true,
		});
		const hasMore = continuationContract.continuation?.hasMore === true;
		const nextOffset = continuationContract.continuation?.nextOffset;

		if (truncated) totalAvailable = total;

		const notes: string[] = [];
		if (context.recencyNote) notes.push(context.recencyNote);
		if (continuationContract.truncationReason) {
			notes.push(continuationContract.truncationReason);
		}
		if (truncated) {
			if (params.returnAll) {
				notes.push(
					`Fetched all ${total} matching records via returnAll; showing first ${MAX_RESPONSE_RECORDS} in this response. ` +
						`Use 'fields' to reduce payload size, or narrow filters to reduce match count.`,
				);
			} else {
				notes.push(
					hasMore
						? `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Use offset=${nextOffset} to see the next page, or use a narrower filter.`
						: `Showing first ${MAX_RESPONSE_RECORDS} of ${total} records. Offset pagination limit (${MAX_QUERY_LIMIT}) reached — use narrower filters to access more records.`,
				);
			}
		}

		const listWarnings: string[] = [...(context.resolutionWarnings ?? [])];
		if (context.recencyWindowLimited) {
			listWarnings.push(
				'500 records were returned for the current recency window. Narrow recency, or provide since/until, to ensure the newest records are included.',
			);
		}

		const pagination: ListPaginationState = {
			hasMore,
			...(nextOffset !== undefined ? { nextOffset } : {}),
			...(totalAvailable !== undefined ? { totalAvailable } : {}),
			...(notes.length > 0 ? { notes } : {}),
			continuation: continuationContract.continuation,
			isTruncated: continuationContract.isTruncated,
			truncationReason: continuationContract.truncationReason,
			serverCap: continuationContract.serverCap,
			clientCap: continuationContract.clientCap,
		};

		const listContext: ToolResponseContext = {
			...context,
			resolutionWarnings: listWarnings,
		};

		return JSON.stringify(buildListResponse(resource, operation, items, pagination, listContext));
	}

	if (responseKind === 'mutation') {
		const validation = validateMutationSuccess(operation, firstRecord);
		if (!validation.ok) {
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					validation.errorType ?? ERROR_TYPES.API_ERROR,
					validation.message ?? `${resource}.${operation} failed validation.`,
					validation.hint ?? `Retry autotask_${resource} with operation '${operation}'.`,
				),
			);
		}

		return JSON.stringify(
			buildMutationResponse(resource, operation, validation.id ?? 'unknown', firstRecord ?? undefined, context),
		);
	}

	switch (operation) {
		case 'get': {
			if (
				firstRecord === null ||
				(typeof firstRecord === 'object' &&
					!Array.isArray(firstRecord) &&
					Object.keys(firstRecord).length === 0)
			) {
				const id = params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${id}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildItemResponse(resource, operation, firstRecord, {}, context));
		}

		case 'whoAmI': {
			if (firstRecord === null || firstRecord === undefined) {
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found for authenticated user.`,
						`Use autotask_${resource} with operation 'getMany' to locate a valid record, then retry.`,
					),
				);
			}
			return JSON.stringify(
				buildItemResponse(resource, operation, firstRecord, { verb: 'Authenticated as' }, context),
			);
		}

		case 'searchByDomain': {
			if (records.length === 0) {
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.NO_RESULTS_FOUND,
						`No ${resource} found matching the supplied domain.`,
						`Verify the domain and retry, or use autotask_${resource} with operation 'getMany' with a filter.`,
					),
				);
			}
			// searchByDomain uses list shape — no domain-specific qualifier in summary since params.domain is not passed
			const resolvedLabels = toResolvedLabels(context.resolutions);
			return JSON.stringify({
				summary: `Found ${records.length} ${resource} records — complete set, no further calls needed.`,
				resource,
				operation: `${resource}.${operation}`,
				records,
				returnedCount: records.length,
				hasMore: false,
				continuation: null,
				isTruncated: false,
				truncationReason: null,
				serverCap: MAX_QUERY_LIMIT,
				clientCap: MAX_RESPONSE_RECORDS,
				resolvedLabels,
				pendingConfirmations: context.pendingConfirmations ?? [],
				warnings: context.resolutionWarnings ?? [],
			});
		}

		case 'slaHealthCheck': {
			if (firstRecord === null || firstRecord === undefined) {
				const identifier = params.ticketNumber ?? params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${identifier}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildSlaHealthCheckResponse(resource, operation, firstRecord, context));
		}

		case 'summary': {
			if (firstRecord === null || firstRecord === undefined) {
				const identifier = params.ticketNumber ?? params.id ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found with id ${identifier}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildTicketSummaryResponse(resource, operation, firstRecord, context));
		}

		case 'delete': {
			const id = params.id ?? extractId(firstRecord) ?? 'unknown';
			return JSON.stringify(buildDeleteResponse(resource, operation, id, context));
		}

		case 'count': {
			const countValue = records[0]?.count ?? records.length;
			return JSON.stringify(buildCountResponse(resource, operation, countValue as number));
		}

		case 'getByResource':
		case 'getByYear': {
			const entity = firstRecord;
			if (
				entity === null ||
				entity === undefined ||
				(typeof entity === 'object' &&
					!Array.isArray(entity) &&
					Object.keys(entity as object).length === 0)
			) {
				if (operation === 'getByYear') {
					const rid = params.resourceID ?? 'unknown';
					const yr = params.year ?? 'unknown';
					return JSON.stringify(
						wrapError(
							resource,
							operation,
							ERROR_TYPES.ENTITY_NOT_FOUND,
							`No ${resource} found for resource ${rid}, year ${yr}.`,
							`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
						),
					);
				}
				const rid = params.resourceID ?? 'unknown';
				return JSON.stringify(
					wrapError(
						resource,
						operation,
						ERROR_TYPES.ENTITY_NOT_FOUND,
						`No ${resource} found for resource ${rid}.`,
						`Use autotask_${resource} with operation 'getMany' and the 'filter_field'/'filter_value' parameters to locate a valid record, extract its numeric 'id', then retry.`,
					),
				);
			}
			return JSON.stringify(buildItemResponse(resource, operation, entity, {}, context));
		}

		default:
			return JSON.stringify(
				wrapError(
					resource,
					operation,
					ERROR_TYPES.INVALID_OPERATION,
					`Unknown operation '${operation}'.`,
					`Use a supported operation for autotask_${resource}.`,
				),
			);
	}
}
