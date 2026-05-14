import type { IDataObject } from 'n8n-workflow';
import type { ExecutorState } from '../executor-state';
import type { FieldMeta } from '../../helpers/aiHelper';
import type { ToolFilter } from '../filter-builder';
import { resolveAndClassifyFilters, resolveCompanyToProjectIdFilter } from '../filter-builder';
import type { LabelResolution, PendingLabelConfirmation } from '../../helpers/label-resolution';
import type { IAutotaskEntity } from '../../types';
import { autotaskApiRequest } from '../../helpers/http';
import { attachCorrelation, buildListResponse, buildItemResponse, buildCountResponse } from '../response-builder';
import { wrapError, ERROR_TYPES } from '../error-formatter';
import { enrichResponseJson } from '../../helpers/enrichment';
import { getIdentifierPairConfig } from '../../constants/resource-operations';
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, getEffectiveLimit, executeCountOperation, probeLimit, applyProbeTruncation } from '../tool-executor-helpers';

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

export async function handleGetByCompanyAndStatus(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId, recencyResult,
		readFields, labelResolutions, labelWarnings,
		effectiveReturnAll } = state;

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
	} = await resolveAndClassifyFilters(context, resource, syntheticFilters, readFields as FieldMeta[], params as IDataObject);
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

	const queryLimitForOp = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit as number) : DEFAULT_QUERY_LIMIT);
	const requestBody: IDataObject = { filter: apiFilters as unknown as IDataObject[] };
	const gbcasProbe = probeLimit(queryLimitForOp);
	if (gbcasProbe !== undefined) {
		requestBody.MaxRecords = gbcasProbe;
	}

	const gbcasResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, requestBody) as { items?: IAutotaskEntity[] };
	const gbcasRawItems = Array.isArray(gbcasResponse.items) ? gbcasResponse.items as Record<string, unknown>[] : [];
	const { items: gbcasItems, hasMore: gbcasHasMore } = applyProbeTruncation(gbcasRawItems, queryLimitForOp);

	const allGbcasWarnings = [...specialWarnings, ...labelWarnings];
	const allGbcasResolutions = [...specialResolutions, ...labelResolutions];

	const gbcasListJson = JSON.stringify(
		buildListResponse(resource, 'getByCompanyAndStatus', gbcasItems, {
			hasMore: gbcasHasMore,
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

export async function handleGetUnassigned(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId, recencyResult,
		readFields, labelResolutions, labelWarnings,
		effectiveReturnAll } = state;

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
	let specialResolutions: LabelResolution[] = [];
	let specialWarnings: string[] = [];
	let specialPending: PendingLabelConfirmation[] = [];

	if (optionalFilters.length > 0) {
		const resolved = await resolveAndClassifyFilters(context, resource, optionalFilters, readFields as FieldMeta[], params as IDataObject);
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
	const queryLimitForOp = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit as number) : DEFAULT_QUERY_LIMIT);
	const requestBody: IDataObject = { filter: apiFilters as unknown as IDataObject[] };
	const unassignedProbe = probeLimit(queryLimitForOp);
	if (unassignedProbe !== undefined) {
		requestBody.MaxRecords = unassignedProbe;
	}

	const unassignedResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, requestBody) as { items?: IAutotaskEntity[] };
	const unassignedRawItems = Array.isArray(unassignedResponse.items) ? unassignedResponse.items as Record<string, unknown>[] : [];
	const { items: unassignedItems, hasMore: unassignedHasMore } = applyProbeTruncation(unassignedRawItems, queryLimitForOp);

	const allUnassignedWarnings = [...specialWarnings, ...labelWarnings];
	const allUnassignedResolutions = [...specialResolutions, ...labelResolutions];

	const unassignedListJson = JSON.stringify(
		buildListResponse(resource, 'getUnassigned', unassignedItems, {
			hasMore: unassignedHasMore,
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

export async function handleGetBySLAStatus(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId, recencyResult,
		readFields, labelResolutions, labelWarnings, effectiveReturnAll } = state;

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
	let slaFilters: IDataObject[];
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
	let slaSpecialResolutions: LabelResolution[] = [];
	let slaSpecialWarnings: string[] = [];
	let slaSpecialPending: PendingLabelConfirmation[] = [];

	if (slaOptionalFilters.length > 0) {
		const resolved = await resolveAndClassifyFilters(context, resource, slaOptionalFilters, readFields as FieldMeta[], params as IDataObject);
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

	const apiSlaFilters: IDataObject[] = [...slaFilters, ...(slaOptionalFilters as unknown as IDataObject[]), ...(recencyResult.filters as unknown as IDataObject[])];
	const queryLimitForSla = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit as number) : DEFAULT_QUERY_LIMIT);
	const slaRequestBody: IDataObject = { filter: apiSlaFilters as IDataObject[] };
	const slaProbe = probeLimit(queryLimitForSla);
	if (slaProbe !== undefined) {
		slaRequestBody.MaxRecords = slaProbe;
	}

	const slaResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, slaRequestBody) as { items?: IAutotaskEntity[] };
	const slaRawItems = Array.isArray(slaResponse.items) ? slaResponse.items as Record<string, unknown>[] : [];
	const { items: slaItems, hasMore: slaHasMore } = applyProbeTruncation(slaRawItems, queryLimitForSla);

	const allSlaWarnings = [...slaSpecialWarnings, ...labelWarnings];
	const allSlaResolutions = [...slaSpecialResolutions, ...labelResolutions];

	const slaListJson = JSON.stringify(
		buildListResponse(resource, 'getBySLAStatus', slaItems, {
			hasMore: slaHasMore,
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

export async function handleGetFullDetail(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId } = state;

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

export async function handleCountByPeriod(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId,
		readFields, labelResolutions, labelWarnings } = state;

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
		const cbpResolved = await resolveAndClassifyFilters(context, resource, cbpOptional, readFields as FieldMeta[], params as IDataObject);
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

export async function handleGetByAge(state: ExecutorState): Promise<string> {
	const { context, params, resource, correlationId, recencyResult,
		readFields, labelResolutions, labelWarnings, effectiveReturnAll } = state;

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

	let ageResolutions: LabelResolution[] = [];
	let ageWarnings: string[] = [];
	let agePending: PendingLabelConfirmation[] = [];
	let ageUnresolved: ToolFilter[] = [];

	if (ageOptionalFilters.length > 0) {
		const ageResolved = await resolveAndClassifyFilters(context, resource, ageOptionalFilters, readFields as FieldMeta[], params as IDataObject);
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
	const ageQueryLimit = effectiveReturnAll ? undefined : (params.limit !== undefined ? getEffectiveLimit(params.limit as number) : DEFAULT_QUERY_LIMIT);
	const ageRequestBody: IDataObject = { filter: ageAllFilters as unknown as IDataObject[] };
	const ageProbe = probeLimit(ageQueryLimit);
	if (ageProbe !== undefined) ageRequestBody.MaxRecords = ageProbe;

	const ageResponse = await autotaskApiRequest.call(context, 'POST', cfg.queryEndpoint, ageRequestBody) as { items?: IAutotaskEntity[] };
	const ageRawItems = Array.isArray(ageResponse.items) ? ageResponse.items as Record<string, unknown>[] : [];
	const { items: ageItems, hasMore: ageHasMore } = applyProbeTruncation(ageRawItems, ageQueryLimit);

	const ageAllWarnings = [...ageWarnings, ...labelWarnings];
	const ageAllResolutions = [...ageResolutions, ...labelResolutions];

	const ageListJson = JSON.stringify(
		buildListResponse(resource, 'getByAge', ageItems, {
			hasMore: ageHasMore,
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
