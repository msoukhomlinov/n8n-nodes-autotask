import {
    formatNotFoundError,
    formatNoResultsFound,
    wrapError,
    wrapSuccess,
    ERROR_TYPES,
    type PaginationInfo,
} from '../error-formatter';
import {
    buildResultPayload,
    type ToolResponseContext,
} from '../response-builder';
import {
    MAX_QUERY_LIMIT,
    getEffectiveLimit,
} from '../tool-executor';

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

export function dispatchOperationResponse(
    resource: string,
    operation: string,
    records: Record<string, unknown>[],
    params: OperationResponseParams,
    context: ToolResponseContext = {},
): string {
    const firstRecord = records[0] ?? null;
    const buildPayload = (
        kind: Parameters<typeof buildResultPayload>[0],
        data: Parameters<typeof buildResultPayload>[1],
        flags: Parameters<typeof buildResultPayload>[2],
        extras: Parameters<typeof buildResultPayload>[3] = {},
    ) =>
        buildResultPayload(kind, data, flags, {
            ...extras,
            resource,
            operation,
            readFields: context.readFields,
        });
    const extractOperationId = (record: Record<string, unknown> | null): number | string | null => {
        if (!record) return null;
        const idCandidate = record.itemId ?? record.id;
        if (typeof idCandidate === 'number' || typeof idCandidate === 'string') {
            return idCandidate;
        }
        return null;
    };

    switch (operation) {
        case 'get': {
            const entity = firstRecord;
            if (
                entity === null ||
                entity === undefined ||
                (Array.isArray(entity) && entity.length === 0) ||
                (typeof entity === 'object' && !Array.isArray(entity) && Object.keys(entity).length === 0)
            ) {
                const id = params.id ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'item',
                        entity,
                        { mutated: false, retryable: true },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
        }

        case 'getMany':
        case 'getPosted':
        case 'getUnposted': {
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
                const noResultsError = formatNoResultsFound(resource, operation, filtersUsed);
                const usedFilterFields = new Set<string>(
                    [
                        typeof params.filter_field === 'string' ? params.filter_field : '',
                        typeof params.filter_field_2 === 'string' ? params.filter_field_2 : '',
                    ]
                        .map((field) => field.trim().toLowerCase())
                        .filter((field) => field !== ''),
                );
                const alternativeFilterFields = (context.readFields ?? [])
                    .filter(
                        (field) =>
                            !field.udf &&
                            typeof field.type === 'string' &&
                            field.type.toLowerCase() === 'string' &&
                            !usedFilterFields.has(field.id.toLowerCase()),
                    )
                    .map((field) => field.id)
                    .slice(0, 10);
                if (alternativeFilterFields.length > 0) {
                    noResultsError.context = {
                        ...noResultsError.context,
                        alternativeFilterFields,
                    };
                }
                const unresolvedFilterWarnings = context.resolutionWarnings ?? [];
                if (unresolvedFilterWarnings.length > 0) {
                    noResultsError.context = {
                        ...noResultsError.context,
                        filterResolutionWarnings: unresolvedFilterWarnings,
                    };
                }
                return JSON.stringify(noResultsError);
            }

            const total = records.length;
            const truncated = total > MAX_RESPONSE_RECORDS;
            const items = truncated ? records.slice(0, MAX_RESPONSE_RECORDS) : records;
            const currentOffset = context.effectiveOffset ?? 0;

            let hasMore = false;
            let nextOffset: number | undefined;
            let totalAvailable: number | undefined;

            if (context.recencyActive) {
                hasMore = false;
                if (truncated) {
                    totalAvailable = total;
                }
            } else if (params.returnAll) {
                hasMore = false;
                if (truncated) {
                    totalAvailable = total;
                }
            } else if (truncated) {
                totalAvailable = total;
                const truncatedNextOffset = currentOffset + MAX_RESPONSE_RECORDS;
                hasMore = truncatedNextOffset < MAX_QUERY_LIMIT;
                if (hasMore) nextOffset = truncatedNextOffset;
            } else if (items.length > 0) {
                const requestedLimit = getEffectiveLimit(params.limit);
                const candidateNext = currentOffset + items.length;
                hasMore = items.length >= requestedLimit && candidateNext < MAX_QUERY_LIMIT;
                if (hasMore) nextOffset = candidateNext;
            }

            const pagination: PaginationInfo = {
                offset: currentOffset,
                hasMore,
                ...(nextOffset !== undefined ? { nextOffset } : {}),
                ...(totalAvailable !== undefined ? { totalAvailable } : {}),
            };

            const notes: string[] = [];
            if (context.recencyNote) notes.push(context.recencyNote);
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

            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'list',
                        { items, count: items.length },
                        { mutated: false, retryable: true, truncated },
                        {
                            warnings: listWarnings,
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                            pagination,
                            notes: notes.length > 0 ? notes : undefined,
                        },
                    ),
                ),
            );
        }

        case 'whoAmI': {
            if (firstRecord === null || firstRecord === undefined) {
                return JSON.stringify(formatNotFoundError(resource, operation, 'authenticated user'));
            }
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'item',
                        firstRecord,
                        { mutated: false, retryable: true },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
        }

        case 'searchByDomain': {
            if (records.length === 0) {
                return JSON.stringify(
                    wrapError(
                        resource,
                        operation,
                        ERROR_TYPES.NO_RESULTS_FOUND,
                        'No company found matching the supplied domain.',
                        `Verify the domain and retry, or use autotask_${resource} with operation 'getMany' with a filter.`,
                    ),
                );
            }
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'list',
                        { items: records, count: records.length },
                        { mutated: false, retryable: true },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                            pagination: { offset: 0, hasMore: false },
                        },
                    ),
                ),
            );
        }

        case 'slaHealthCheck': {
            if (firstRecord === null || firstRecord === undefined) {
                const identifier = params.ticketNumber ?? params.id ?? 'unknown';
                return JSON.stringify(
                    formatNotFoundError(resource, operation, identifier as number | string),
                );
            }
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'item',
                        firstRecord,
                        { mutated: false, retryable: true },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
        }

        case 'summary': {
            if (firstRecord === null || firstRecord === undefined) {
                const identifier = params.ticketNumber ?? params.id ?? 'unknown';
                return JSON.stringify(
                    formatNotFoundError(resource, operation, identifier as number | string),
                );
            }
            const summaryRecord = firstRecord as {
                _meta?: { countsPartial?: boolean; truncationApplied?: boolean };
            };
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'summary',
                        firstRecord,
                        {
                            mutated: false,
                            retryable: true,
                            partial: summaryRecord._meta?.countsPartial === true,
                            truncated: summaryRecord._meta?.truncationApplied === true,
                        },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
        }

        case 'moveConfigurationItem':
        case 'moveToCompany':
        case 'approve':
        case 'reject':
        case 'transferOwnership':
        case 'create':
        case 'update':
        case 'delete': {
            if (
                (operation === 'moveConfigurationItem' ||
                    operation === 'moveToCompany' ||
                    operation === 'approve' ||
                    operation === 'reject' ||
                    operation === 'transferOwnership') &&
                (firstRecord === null || firstRecord === undefined)
            ) {
                const id = params.id ?? 'unknown';
                if (operation === 'transferOwnership') {
                    return JSON.stringify(
                        wrapError(
                            resource,
                            operation,
                            ERROR_TYPES.ENTITY_NOT_FOUND,
                            'Transfer ownership returned no result.',
                            `Verify source and destination resource IDs, then retry.`,
                        ),
                    );
                }
                return JSON.stringify(formatNotFoundError(resource, operation, id as number | string));
            }

            const approveId =
                operation === 'approve' || operation === 'reject'
                    ? (params.id as number | undefined) ?? extractOperationId(firstRecord)
                    : extractOperationId(firstRecord);

            const mutationData =
                operation === 'delete'
                    ? { id: params.id, deleted: true }
                    : operation === 'approve' || operation === 'reject'
                      ? { id: approveId, entity: firstRecord }
                      : { id: extractOperationId(firstRecord), entity: firstRecord };

            const retryable =
                operation === 'create' ? false : true;

            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'mutation',
                        mutationData,
                        { mutated: true, retryable },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
        }

        case 'count': {
            const countValue = records[0]?.count ?? records.length;
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload('count', { count: countValue }, { mutated: false, retryable: true }),
                ),
            );
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
                        formatNotFoundError(resource, operation, `resource ${rid}, year ${yr}`),
                    );
                }
                const rid = params.resourceID ?? 'unknown';
                return JSON.stringify(formatNotFoundError(resource, operation, rid as number | string));
            }
            return JSON.stringify(
                wrapSuccess(
                    resource,
                    operation,
                    buildPayload(
                        'item',
                        entity,
                        { mutated: false, retryable: true },
                        {
                            warnings: context.resolutionWarnings ?? [],
                            pendingConfirmations: context.pendingConfirmations ?? [],
                            appliedResolutions: context.resolutions ?? [],
                        },
                    ),
                ),
            );
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
