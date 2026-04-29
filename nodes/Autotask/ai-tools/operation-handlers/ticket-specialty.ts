import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import type { ExecutorState } from '../executor-state';
import type { LabelResolution } from '../../helpers/label-resolution';
import type { IAutotaskEntity } from '../../types';
import { autotaskApiRequest } from '../../helpers/http';
import { attachCorrelation, buildListResponse } from '../response-builder';
import { wrapError, formatApiError, ERROR_TYPES } from '../error-formatter';
import { enrichResponseJson } from '../../helpers/enrichment';
import { getIdentifierPairConfig } from '../../constants/resource-operations';
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, getEffectiveLimit } from '../tool-executor-helpers';
import type { ToolFilter } from '../filter-builder';

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

export async function handleGetByResource(state: ExecutorState): Promise<string> {
	const { context, resource, params, recencyResult, labelResolutions, labelWarnings, correlationId } = state;

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
			const { EntityValueHelper } = await import('../../helpers/entity-values/value-helper');
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
			const { EntityValueHelper } = await import('../../helpers/entity-values/value-helper');
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
	const effectiveReturnAllGbr = Boolean(params.returnAll);
	const queryLimitForOp = effectiveReturnAllGbr
		? undefined
		: params.limit !== undefined
			? getEffectiveLimit(params.limit as number | undefined)
			: DEFAULT_QUERY_LIMIT;
	const excludeTerminalGbr = (params as Record<string, unknown>).excludeTerminalStatuses !== false && (params as Record<string, unknown>).excludeTerminalStatuses !== 0;
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

export async function handleSearchByKeyword(state: ExecutorState): Promise<string> {
	const { context, resource, params, recencyResult, labelResolutions, labelWarnings,
		effectiveReturnAll, correlationId } = state;

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

	const includeNotes = Boolean((params as Record<string, unknown>).includeNotes);
	const includeTimeEntries = Boolean((params as Record<string, unknown>).includeTimeEntries);

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
			? getEffectiveLimit(params.limit as number | undefined)
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

export async function handleTimeline(state: ExecutorState): Promise<string> {
	const { context, resource, params, labelWarnings, labelResolutions, correlationId } = state;

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

	const includeHistories = Boolean((params as Record<string, unknown>).includeHistories);
	const textLimit = typeof params.textLimit === 'number' ? params.textLimit : 500;
	const timelineLimit = typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), MAX_QUERY_LIMIT) : 50;

	const { buildTicketTimeline } = await import('../../helpers/ticket-timeline');
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
