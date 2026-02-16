import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity, IQueryResponse } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
	DeleteOperation,
} from '../../operations/base';
import { autotaskApiRequest, buildEntityUrl } from '../../helpers/http';
import { FilterOperators } from '../../constants/filters';
import { API_CONSTANTS, BILLING_ITEMS, ENTITY_NAMES } from '../../constants';
import { processOutputMode } from '../../helpers/output-mode';
import { processResponseDatesArray, getConfiguredTimezone } from '../../helpers/date-time';
import { flattenUdfsArray } from '../../helpers/udf/flatten';
import {
	getSelectedColumns,
	filterEntitiesBySelectedColumns,
} from '../../operations/common/select-columns/filter-entity';
import moment from 'moment-timezone';

const ENTITY_TYPE = 'TimeEntry';

function buildIdBatches(ids: number[]): number[][] {
	const batches: number[][] = [];
	for (let start = 0; start < ids.length; start += API_CONSTANTS.MAX_OR_CONDITIONS) {
		batches.push(ids.slice(start, start + API_CONSTANTS.MAX_OR_CONDITIONS));
	}
	return batches;
}

async function runBatchesWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) {
		return;
	}

	const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
	let currentIndex = 0;

	await Promise.all(
		Array.from({ length: boundedConcurrency }, async () => {
			while (currentIndex < items.length) {
				const itemIndex = currentIndex++;
				if (itemIndex >= items.length) {
					return;
				}
				await worker(items[itemIndex]);
			}
		}),
	);
}

/**
 * Queries BillingItems to determine which time entry IDs have been approved and posted.
 * Handles batching (max 500 IDs per query) and pagination automatically.
 *
 * @returns A Set of time entry IDs that have a matching BillingItem (i.e. are posted).
 */
async function getPostedTimeEntryIds(
	context: IExecuteFunctions,
	timeEntries: IAutotaskEntity[],
): Promise<Set<number>> {
	const postedIds = new Set<number>();
	const allIds = timeEntries
		.map((entry) => entry.id as number)
		.filter((id) => id != null);

	if (allIds.length === 0) {
		return postedIds;
	}

	// Process top-level ID batches concurrently (bounded), while each batch still paginates serially.
	const batches = buildIdBatches(allIds);
	await runBatchesWithConcurrency(
		batches,
		API_CONSTANTS.MAX_CONCURRENT_REQUESTS,
		async (batch) => {
			const endpoint = buildEntityUrl(ENTITY_NAMES.BILLING_ITEMS, { isQuery: true });
			const queryBody = {
				filter: [
					{ field: 'timeEntryID', op: FilterOperators.in, value: batch },
					{
						field: 'billingItemType',
						op: FilterOperators.in,
						value: [BILLING_ITEMS.TYPE_LABOUR, BILLING_ITEMS.TYPE_LABOUR_ADJUSTMENT],
					},
				],
				IncludeFields: ['timeEntryID'],
			};

			// Initial query
			let response = await autotaskApiRequest.call(
				context,
				'POST',
				endpoint,
				queryBody as unknown as IDataObject,
			) as IQueryResponse<IAutotaskEntity>;

			// Collect posted IDs from results
			if (response.items) {
				for (const item of response.items) {
					if (item.timeEntryID != null) {
						postedIds.add(item.timeEntryID as number);
					}
				}
			}

			// Handle pagination — a batch could return multiple pages
			while (response.pageDetails?.nextPageUrl) {
				response = await autotaskApiRequest.call(
					context,
					'POST',
					response.pageDetails.nextPageUrl,
					queryBody as unknown as IDataObject,
				) as IQueryResponse<IAutotaskEntity>;

				if (response.items) {
					for (const item of response.items) {
						if (item.timeEntryID != null) {
							postedIds.add(item.timeEntryID as number);
						}
					}
				}
			}
		},
	);

	return postedIds;
}

/**
 * Generic batched query helper. Queries an entity with an `id in [batch]` filter
 * (plus optional extra filters), collects items across batches and pages.
 *
 * @param context       n8n execution context
 * @param entityName    REST API entity name (e.g. 'Tickets')
 * @param ids           IDs to look up
 * @param extraFilters  Additional filter conditions appended to each batch
 * @param includeFields Fields to return (minimise payload)
 * @returns All matching entity items
 */
async function batchQueryByIds(
	context: IExecuteFunctions,
	entityName: string,
	ids: number[],
	extraFilters: Array<{ field: string; op: string; value: unknown }>,
	includeFields: string[],
): Promise<IAutotaskEntity[]> {
	const results: IAutotaskEntity[] = [];
	if (ids.length === 0) return results;

	const batches = buildIdBatches(ids);
	await runBatchesWithConcurrency(
		batches,
		API_CONSTANTS.MAX_CONCURRENT_REQUESTS,
		async (batch) => {
			const endpoint = buildEntityUrl(entityName, { isQuery: true });
			const queryBody = {
				filter: [
					{ field: 'id', op: FilterOperators.in, value: batch },
					...extraFilters,
				],
				IncludeFields: includeFields,
			};

			let response = (await autotaskApiRequest.call(
				context,
				'POST',
				endpoint,
				queryBody as unknown as IDataObject,
			)) as IQueryResponse<IAutotaskEntity>;

			if (response.items) results.push(...response.items);

			while (response.pageDetails?.nextPageUrl) {
				response = (await autotaskApiRequest.call(
					context,
					'POST',
					response.pageDetails.nextPageUrl,
					queryBody as unknown as IDataObject,
				)) as IQueryResponse<IAutotaskEntity>;
				if (response.items) results.push(...response.items);
			}
		},
	);

	return results;
}

/**
 * Applies Tier 2 cross-entity post-filters to a set of TimeEntry items.
 * Each filter is skipped when its parameter is empty / default.
 * Filters are applied in order; each one narrows the set for the next.
 *
 * @param context     n8n execution context
 * @param entries     TimeEntry items to filter
 * @param filterOpts  The parsed `filters` collection from the node parameters
 */
async function applyCrossEntityFilters(
	context: IExecuteFunctions,
	entries: IAutotaskEntity[],
	filterOpts: IDataObject,
): Promise<IAutotaskEntity[]> {
	let filtered = entries;

	// ── Contract Type ──────────────────────────────────────────────────
	// NOTE: In the bounded streaming path this lookup runs per page. The
	// result is identical each time. Acceptable for typical maxRecords
	// usage (few pages, cheap lookup). If contract queries appear
	// repeatedly in logs, consider hoisting the lookup to the caller.
	const contractTypeFilter = ((filterOpts.contractTypeFilter ?? '') as string).trim();
	if (contractTypeFilter && filtered.length > 0) {
		const contractTypeValue = Number(contractTypeFilter);
		// Query Contracts of the requested type and collect their IDs
		const endpoint = buildEntityUrl(ENTITY_NAMES.CONTRACTS, { isQuery: true });
		const queryBody = {
			filter: [
				{ field: 'contractType', op: FilterOperators.eq, value: contractTypeValue },
			],
			IncludeFields: ['id'],
		};

		const contractIds = new Set<number>();
		let response = (await autotaskApiRequest.call(
			context,
			'POST',
			endpoint,
			queryBody as unknown as IDataObject,
		)) as IQueryResponse<IAutotaskEntity>;
		if (response.items) {
			for (const c of response.items) contractIds.add(c.id as number);
		}
		while (response.pageDetails?.nextPageUrl) {
			response = (await autotaskApiRequest.call(
				context,
				'POST',
				response.pageDetails.nextPageUrl,
				queryBody as unknown as IDataObject,
			)) as IQueryResponse<IAutotaskEntity>;
			if (response.items) {
				for (const c of response.items) contractIds.add(c.id as number);
			}
		}

		filtered = filtered.filter(
			(e) => e.contractID != null && contractIds.has(e.contractID as number),
		);
	}

	// ── Ticket Status + Queue (both live on Ticket) ───────────────────
	const ticketStatusRaw = filterOpts.ticketStatusFilter;
	const ticketStatusSelection = (Array.isArray(ticketStatusRaw) ? ticketStatusRaw : []) as string[];
	const statusValues = ticketStatusSelection.map((s) => Number(s)).filter((n) => !isNaN(n));
	const queueFilter = ((filterOpts.queueFilter ?? '') as string).trim();
	const queueId = queueFilter ? Number(queueFilter) : NaN;
	const hasTicketStatusFilter = statusValues.length > 0;
	const hasQueueFilter = queueFilter !== '' && !isNaN(queueId);

	if ((hasTicketStatusFilter || hasQueueFilter) && filtered.length > 0) {
		const ticketIds = [
			...new Set(
				filtered
					.map((e) => e.ticketID as number | null)
					.filter((id): id is number => id != null),
			),
		];

		if (ticketIds.length > 0) {
			const ticketFilters: Array<{ field: string; op: string; value: unknown }> = [];
			if (hasTicketStatusFilter) {
				ticketFilters.push({ field: 'status', op: FilterOperators.in, value: statusValues });
			}
			if (hasQueueFilter) {
				ticketFilters.push({ field: 'queueID', op: FilterOperators.eq, value: queueId });
			}

			const matchingTickets = await batchQueryByIds(
				context,
				ENTITY_NAMES.TICKETS,
				ticketIds,
				ticketFilters,
				['id'],
			);
			const matchingTicketIds = new Set(matchingTickets.map((t) => t.id as number));

			filtered = filtered.filter(
				(e) => e.ticketID == null || matchingTicketIds.has(e.ticketID as number),
			);
		}
	}
	// ── Task Status ────────────────────────────────────────────────────
	const taskStatusRaw = filterOpts.taskStatusFilter;
	const taskStatusSelection = (Array.isArray(taskStatusRaw) ? taskStatusRaw : []) as string[];
	if (taskStatusSelection.length > 0 && filtered.length > 0) {
		const statusValues = taskStatusSelection.map((s) => Number(s)).filter((n) => !isNaN(n));

		if (statusValues.length > 0) {
			const taskIds = [
				...new Set(
					filtered
						.map((e) => e.taskID as number | null)
						.filter((id): id is number => id != null),
				),
			];

			const matchingTasks = await batchQueryByIds(
				context,
				ENTITY_NAMES.TASKS,
				taskIds,
				[{ field: 'status', op: FilterOperators.in, value: statusValues }],
				['id'],
			);
			const matchingTaskIds = new Set(matchingTasks.map((t) => t.id as number));

			filtered = filtered.filter(
				(e) => e.taskID == null || matchingTaskIds.has(e.taskID as number),
			);
		}
	}

	// ── Account Manager (Company.ownerResourceID) ──────────────────────
	const accountManagerFilter = ((filterOpts.accountManagerFilter ?? '') as string).trim();
	if (accountManagerFilter && filtered.length > 0) {
		const ownerResourceId = Number(accountManagerFilter);
		if (!isNaN(ownerResourceId)) {
			// Collect companyIDs from tickets
			const ticketIds = [
				...new Set(
					filtered
						.map((e) => e.ticketID as number | null)
						.filter((id): id is number => id != null),
				),
			];
			const ticketItems = await batchQueryByIds(
				context,
				ENTITY_NAMES.TICKETS,
				ticketIds,
				[],
				['id', 'companyID'],
			);
			const ticketToCompany = new Map<number, number>();
			for (const t of ticketItems) {
				if (t.companyID != null) {
					ticketToCompany.set(t.id as number, t.companyID as number);
				}
			}

			// Collect companyIDs from tasks (Task → Project → companyID)
			const taskIds = [
				...new Set(
					filtered
						.map((e) => e.taskID as number | null)
						.filter((id): id is number => id != null),
				),
			];
			const taskToCompany = new Map<number, number>();
			if (taskIds.length > 0) {
				// Get projectID for each task
				const taskItems = await batchQueryByIds(
					context,
					ENTITY_NAMES.TASKS,
					taskIds,
					[],
					['id', 'projectID'],
				);
				const taskToProject = new Map<number, number>();
				const projectIds = new Set<number>();
				for (const t of taskItems) {
					if (t.projectID != null) {
						taskToProject.set(t.id as number, t.projectID as number);
						projectIds.add(t.projectID as number);
					}
				}

				// Get companyID for each project
				if (projectIds.size > 0) {
					const projectItems = await batchQueryByIds(
						context,
						ENTITY_NAMES.PROJECTS,
						[...projectIds],
						[],
						['id', 'companyID'],
					);
					const projectToCompany = new Map<number, number>();
					for (const p of projectItems) {
						if (p.companyID != null) {
							projectToCompany.set(p.id as number, p.companyID as number);
						}
					}

					// Map task → company via project
					for (const [taskId, projectId] of taskToProject) {
						const companyId = projectToCompany.get(projectId);
						if (companyId != null) {
							taskToCompany.set(taskId, companyId);
						}
					}
				}
			}

			// Collect all unique company IDs and filter by ownerResourceID
			const allCompanyIds = new Set<number>();
			for (const cid of ticketToCompany.values()) allCompanyIds.add(cid);
			for (const cid of taskToCompany.values()) allCompanyIds.add(cid);

			const matchingCompanyIds = new Set<number>();
			if (allCompanyIds.size > 0) {
				const companyItems = await batchQueryByIds(
					context,
					ENTITY_NAMES.COMPANIES,
					[...allCompanyIds],
					[{ field: 'ownerResourceID', op: FilterOperators.eq, value: ownerResourceId }],
					['id'],
				);
				for (const c of companyItems) matchingCompanyIds.add(c.id as number);
			}

			// Filter entries: keep those whose ticket or task resolves to a matching company
			filtered = filtered.filter((e) => {
				if (e.ticketID != null) {
					const companyId = ticketToCompany.get(e.ticketID as number);
					return companyId != null && matchingCompanyIds.has(companyId);
				}
				if (e.taskID != null) {
					const companyId = taskToCompany.get(e.taskID as number);
					return companyId != null && matchingCompanyIds.has(companyId);
				}
				// Cross-entity filters only apply where there is a parent relationship.
				// Keep internal/general entries (no ticket/task) consistent with other filters.
				return true;
			});
		}
	}

	return filtered;
}

async function fetchTimeEntryPage(
	context: IExecuteFunctions,
	filters: Array<{ field?: string; op?: string; value?: unknown }>,
	nextPageUrl?: string,
): Promise<IQueryResponse<IAutotaskEntity>> {
	const queryFilters = [...filters];
	if (queryFilters.length === 0) {
		queryFilters.push({
			field: 'id',
			op: FilterOperators.exist,
		});
	}

	const queryBody = {
		filter: queryFilters,
	};

	const endpoint = nextPageUrl ?? buildEntityUrl(ENTITY_TYPE, { isQuery: true });
	return (await autotaskApiRequest.call(
		context,
		'POST',
		endpoint,
		queryBody as unknown as IDataObject,
	)) as IQueryResponse<IAutotaskEntity>;
}

/**
 * Shared logic for getPosted / getUnposted operations.
 * Phase 1: Queries all matching TimeEntries (ignoring user pagination to get the full set).
 * Phase 2: Cross-references with BillingItems to determine posting status.
 * Returns the filtered set with user pagination and enrichment applied.
 *
 * Future optimisation: add an adaptive BillingItems-first path for getPosted
 * when query selectivity is low on TimeEntries-side filters.
 */
async function getTimeEntriesByPostingStatus(
	context: IExecuteFunctions,
	mode: 'posted' | 'unposted',
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	// ------------------------------------------------------------------
	// 1. Read the user's pagination preferences (applied AFTER filtering)
	// ------------------------------------------------------------------
	const returnAll = context.getNodeParameter('returnAll', itemIndex, true) as boolean;
	const maxRecords = !returnAll
		? (context.getNodeParameter('maxRecords', itemIndex, 10) as number)
		: 0;

	// ------------------------------------------------------------------
	// 2. Build TimeEntry filters
	// ------------------------------------------------------------------
	// The resource mapper is not shown for getPosted/getUnposted (all
	// user-facing filters live in the filters collection below). We still
	// create a GetManyOperation for the returnAll=true bulk-fetch path.
	const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, context, {
		skipEnrichment: true,
		isPicklistQuery: true,
	});

	// Attempt to read resource mapper filters; returns empty when the
	// parameter is not displayed for this operation.
	let filters: Awaited<ReturnType<typeof getManyOp.buildFiltersFromResourceMapper>>;
	try {
		filters = await getManyOp.buildFiltersFromResourceMapper(itemIndex);
	} catch {
		filters = [];
	}

	// ------------------------------------------------------------------
	// 3. Read the filters collection (all filter fields live here)
	// ------------------------------------------------------------------
	const filterOpts = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	// Time entry type
	const timeEntryType = (filterOpts.timeEntryTypeFilter ?? 0) as number;
	if (timeEntryType !== 0) {
		filters.push({
			field: 'timeEntryType',
			op: FilterOperators.eq,
			value: timeEntryType,
		});
	}

	// Date range (dateWorked)
	const dateRange = (filterOpts.dateRange ?? '') as string;
	if (dateRange) {
		const tz = await getConfiguredTimezone.call(context);
		let from: moment.Moment | undefined;
		let to: moment.Moment | undefined;

		switch (dateRange) {
			case 'today':
				from = moment.tz(tz).startOf('day');
				to = moment.tz(tz).endOf('day');
				break;
			case 'yesterday':
				from = moment.tz(tz).subtract(1, 'day').startOf('day');
				to = moment.tz(tz).subtract(1, 'day').endOf('day');
				break;
			case 'last24h':
				from = moment.tz(tz).subtract(24, 'hours');
				to = moment.tz(tz);
				break;
			case 'last7':
				from = moment.tz(tz).subtract(7, 'days').startOf('day');
				to = moment.tz(tz).endOf('day');
				break;
			case 'last14':
				from = moment.tz(tz).subtract(14, 'days').startOf('day');
				to = moment.tz(tz).endOf('day');
				break;
			case 'last30':
				from = moment.tz(tz).subtract(30, 'days').startOf('day');
				to = moment.tz(tz).endOf('day');
				break;
			case 'last90':
				from = moment.tz(tz).subtract(90, 'days').startOf('day');
				to = moment.tz(tz).endOf('day');
				break;
			case 'lastFullWeek':
				from = moment.tz(tz).subtract(1, 'week').startOf('isoWeek');
				to = moment.tz(tz).subtract(1, 'week').endOf('isoWeek');
				break;
			case 'lastFullFortnight':
				from = moment.tz(tz).subtract(2, 'weeks').startOf('isoWeek');
				to = moment.tz(tz).subtract(1, 'week').endOf('isoWeek');
				break;
			case 'lastFullMonth':
				from = moment.tz(tz).subtract(1, 'month').startOf('month');
				to = moment.tz(tz).subtract(1, 'month').endOf('month');
				break;
			case 'lastFullQuarter':
				from = moment.tz(tz).subtract(1, 'quarter').startOf('quarter');
				to = moment.tz(tz).subtract(1, 'quarter').endOf('quarter');
				break;
			case 'customRange': {
				const dateFromStr = (filterOpts.dateFrom ?? '') as string;
				const dateToStr = (filterOpts.dateTo ?? '') as string;
				if (dateFromStr) {
					from = moment.tz(dateFromStr, tz);
				}
				if (dateToStr) {
					to = moment.tz(dateToStr, tz);
				}
				break;
			}
		}

		if (from && from.isValid()) {
			filters.push({
				field: 'dateWorked',
				op: FilterOperators.gte,
				value: from.utc().format('YYYY-MM-DDTHH:mm:ss[Z]'),
			});
		}
		if (to && to.isValid()) {
			filters.push({
				field: 'dateWorked',
				op: FilterOperators.lte,
				value: to.utc().format('YYYY-MM-DDTHH:mm:ss[Z]'),
			});
		}
	}

	// Billable status
	const billableFilter = (filterOpts.billableFilter ?? 0) as number;
	if (billableFilter === 1) {
		filters.push({ field: 'isNonBillable', op: FilterOperators.eq, value: false });
	} else if (billableFilter === 2) {
		filters.push({ field: 'isNonBillable', op: FilterOperators.eq, value: true });
	}

	// Hours worked range
	const hoursMin = (filterOpts.hoursWorkedMin ?? '') as string;
	if (hoursMin !== '' && Number(hoursMin) >= 0) {
		filters.push({ field: 'hoursWorked', op: FilterOperators.gte, value: Number(hoursMin) });
	}
	const hoursMax = (filterOpts.hoursWorkedMax ?? '') as string;
	if (hoursMax !== '' && Number(hoursMax) > 0) {
		filters.push({ field: 'hoursWorked', op: FilterOperators.lte, value: Number(hoursMax) });
	}

	// Resource (technician) filter
	const resourceFilter = (filterOpts.resourceFilter ?? '') as string;
	if (resourceFilter) {
		filters.push({ field: 'resourceID', op: FilterOperators.eq, value: Number(resourceFilter) });
	}

	let filteredEntries: IAutotaskEntity[];

	if (!returnAll && maxRecords > 0) {
		// Bounded mode: stream pages and stop once we've collected enough matches.
		filteredEntries = [];
		let nextPageUrl: string | undefined;

		while (filteredEntries.length < maxRecords) {
			const response = await fetchTimeEntryPage(context, filters, nextPageUrl);
			const pageItems = response.items ?? [];
			nextPageUrl = response.pageDetails?.nextPageUrl ?? undefined;

			if (pageItems.length > 0) {
				const crossFiltered = await applyCrossEntityFilters(context, pageItems, filterOpts);
				if (crossFiltered.length > 0) {
					const postedIds = await getPostedTimeEntryIds(context, crossFiltered);
					const pageMatches =
						mode === 'unposted'
							? crossFiltered.filter((entry) => !postedIds.has(entry.id as number))
							: crossFiltered.filter((entry) => postedIds.has(entry.id as number));
					if (pageMatches.length > 0) {
						filteredEntries.push(...pageMatches);
					}
				}
			}

			if (!nextPageUrl) {
				break;
			}
		}
	} else {
		// returnAll (or invalid maxRecords): retain full-set behaviour for compatibility.
		const allTimeEntries = await getManyOp.execute({ filter: filters }, itemIndex);
		if (allTimeEntries.length === 0) {
			return [];
		}

		const crossFiltered = await applyCrossEntityFilters(context, allTimeEntries, filterOpts);
		if (crossFiltered.length === 0) {
			return [];
		}

		const postedIds = await getPostedTimeEntryIds(context, crossFiltered);
		filteredEntries =
			mode === 'unposted'
				? crossFiltered.filter((entry) => !postedIds.has(entry.id as number))
				: crossFiltered.filter((entry) => postedIds.has(entry.id as number));
	}

	// ------------------------------------------------------------------
	// 7. Apply the user's maxRecords limit to the final set
	// ------------------------------------------------------------------
	if (!returnAll && maxRecords > 0 && filteredEntries.length > maxRecords) {
		filteredEntries = filteredEntries.slice(0, maxRecords);
	}

	// ------------------------------------------------------------------
	// 8. Apply enrichment and post-processing (mirrors GetManyOperation)
	// ------------------------------------------------------------------
	if (filteredEntries.length > 0) {
		// Output mode processing (picklist labels, reference labels, etc.)
		filteredEntries = (await processOutputMode(
			filteredEntries,
			ENTITY_TYPE,
			context,
			itemIndex,
		)) as IAutotaskEntity[];

		// Date/time conversion
		try {
			filteredEntries = (await processResponseDatesArray.call(
				context,
				filteredEntries,
				`${ENTITY_TYPE}.${mode === 'posted' ? 'getPosted' : 'getUnposted'}`,
			)) as IAutotaskEntity[];
		} catch (error) {
			console.warn(
				`[TimeEntry.${mode}] Error processing dates: ${(error as Error).message}`,
			);
		}

		// UDF flattening
		try {
			const shouldFlattenUdfs = context.getNodeParameter(
				'flattenUdfs',
				itemIndex,
				false,
			) as boolean;
			if (shouldFlattenUdfs) {
				filteredEntries = flattenUdfsArray(filteredEntries);
			}
		} catch (error) {
			// Parameter may not exist — not an error
			console.warn(
				`[TimeEntry.${mode}] Error checking flattenUdfs: ${(error as Error).message}`,
			);
		}

		// ------------------------------------------------------------------
		// 9. Apply select columns filter (client-side, after enrichment)
		// ------------------------------------------------------------------
		const selectedColumns = getSelectedColumns(context, itemIndex);
		if (selectedColumns.length > 0) {
			filteredEntries = filterEntitiesBySelectedColumns(
				filteredEntries,
				selectedColumns,
			) as IAutotaskEntity[];
		}
	}

	return filteredEntries.map((item) => ({ json: item }));
}

export async function executeTimeEntryOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await createOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'update': {
					const entityId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, entityId);
					returnData.push({ json: response });
					break;
				}

				case 'delete': {
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await deleteOp.execute(i);
					returnData.push({ json: (response || { success: true }) as IDataObject });
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}
				case 'getUnposted':
				case 'getPosted': {
					const mode = operation === 'getPosted' ? 'posted' : 'unposted';
					const results = await getTimeEntriesByPostingStatus(this, mode, i);
					returnData.push(...results);
					break;
				}

				case 'count': {
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const count = await countOp.execute(i);
					returnData.push({
						json: {
							count,
							entityType: ENTITY_TYPE,
						},
					});
					break;
				}
				default:
					throw new Error(`Operation ${operation} is not supported`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
