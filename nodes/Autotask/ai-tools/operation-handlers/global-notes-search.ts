import type { IDataObject } from 'n8n-workflow';
import type { ExecutorState } from '../executor-state';
import { wrapError, ERROR_TYPES } from '../error-formatter';
import { enrichResponseJson } from '../../helpers/enrichment';
import { autotaskApiRequest } from '../../helpers/http';
import { attachCorrelation } from '../response-builder';

interface NoteEntityConfig {
	key: string;
	endpoint: string;
	parentFK: string;
	titleField: string;
	bodyField: string;
	includeFields: string[];
}

const ENTITY_CONFIGS: NoteEntityConfig[] = [
	{
		key: 'ticketNote', endpoint: 'TicketNotes/query', parentFK: 'ticketID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'ticketID', 'noteType', 'publish'],
	},
	{
		key: 'companyNote', endpoint: 'CompanyNotes/query', parentFK: 'companyID',
		titleField: 'name', bodyField: 'note',
		includeFields: ['id', 'name', 'note', 'createDateTime', 'companyID'],
	},
	{
		key: 'projectNote', endpoint: 'ProjectNotes/query', parentFK: 'projectID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'projectID', 'noteType', 'publish'],
	},
	{
		key: 'taskNote', endpoint: 'TaskNotes/query', parentFK: 'taskID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'taskID', 'noteType', 'publish'],
	},
	{
		key: 'contractNote', endpoint: 'ContractNotes/query', parentFK: 'contractID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'contractID'],
	},
	{
		key: 'configurationItemNote', endpoint: 'ConfigurationItemNotes/query', parentFK: 'configurationItemID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'configurationItemID', 'noteType'],
	},
	{
		key: 'productNote', endpoint: 'ProductNotes/query', parentFK: 'productID',
		titleField: 'title', bodyField: 'description',
		includeFields: ['id', 'title', 'description', 'createDateTime', 'creatorResourceID', 'productID'],
	},
];

export async function handleSearchNotes(state: ExecutorState): Promise<string> {
	const { context, params, correlationId } = state;

	const keyword = params['keyword'] as string | undefined;
	const since = params['since'] as string | undefined;
	const until = params['until'] as string | undefined;
	const limitRaw = params['limit'] as number | undefined;
	const limit = Math.max(1, Math.min(limitRaw ?? 10, 25));

	if (!keyword && !since && !until) {
		return attachCorrelation(
			JSON.stringify(wrapError(
				'globalNotesSearch',
				'searchNotes',
				ERROR_TYPES.MISSING_REQUIRED_FIELDS,
				'At least one of keyword, since, or until is required.',
				"autotask_globalNotesSearch with operation 'searchNotes'",
				{ missingFields: ['keyword', 'since', 'until'] },
			)),
			correlationId,
		);
	}

	const warnings: string[] = [];

	const results = await Promise.all(
		ENTITY_CONFIGS.map(async (cfg) => {
			try {
				const filter: IDataObject[] = [];

				if (keyword) {
					filter.push({
						op: 'or',
						items: [
							{ field: cfg.titleField, op: 'contains', value: keyword },
							{ field: cfg.bodyField, op: 'contains', value: keyword },
						],
					} as IDataObject);
				}
				if (since) {
					filter.push({ field: 'createDateTime', op: 'gte', value: since } as IDataObject);
				}
				if (until) {
					filter.push({ field: 'createDateTime', op: 'lte', value: until } as IDataObject);
				}

				const body: IDataObject = {
					filter,
					IncludeFields: cfg.includeFields,
					MaxRecords: limit,
				};

				const response = await autotaskApiRequest.call(
					context, 'POST', cfg.endpoint, body,
				) as { items?: IDataObject[] };

				const items: IDataObject[] = response?.items ?? [];
				return { cfg, items, truncated: items.length === limit };
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				warnings.push(`${cfg.key} query failed: ${msg}`);
				return { cfg, items: [] as IDataObject[], truncated: false };
			}
		}),
	);

	const records: IDataObject[] = [];
	const groupCounts: Record<string, number> = {};
	const truncatedEntities: string[] = [];

	for (const { cfg, items, truncated } of results) {
		groupCounts[cfg.key] = items.length;
		if (truncated) truncatedEntities.push(cfg.key);
		for (const item of items) {
			records.push({
				...item,
				entityType: cfg.key,
				_displayTitle: item[cfg.titleField] ?? null,
				_displayBody: item[cfg.bodyField] ?? null,
			});
		}
	}

	// Sort merged flat list by createDateTime desc
	records.sort((a, b) => {
		const ta = a['createDateTime'] ? new Date(a['createDateTime'] as string).getTime() : 0;
		const tb = b['createDateTime'] ? new Date(b['createDateTime'] as string).getTime() : 0;
		return tb - ta;
	});

	const totalCount = records.length;

	// Enrich — enrichResponseJson detects records[] at top level and applies ENRICHMENT_REGISTRY
	const enrichedJson = await enrichResponseJson(
		JSON.stringify({ records }),
		context,
	);
	const enrichedParsed = JSON.parse(enrichedJson) as { records: IDataObject[] };

	const nonEmptyGroups = Object.entries(groupCounts)
		.filter(([, count]) => count > 0)
		.map(([key, count]) => `${key}: ${count}`)
		.join(', ');

	const summaryBase = totalCount > 0
		? `Found ${totalCount} notes${keyword ? ` matching '${keyword}'` : ''}${nonEmptyGroups ? ` (${nonEmptyGroups})` : ''}.`
		: `No notes found${keyword ? ` matching '${keyword}'` : ''}.`;

	const capNote = truncatedEntities.length > 0
		? ` ${truncatedEntities.join(', ')} results capped at limit=${limit}.`
		: '';

	const response: IDataObject = {
		summary: summaryBase + capNote,
		totalCount,
		records: enrichedParsed.records,
		groupCounts,
		...(truncatedEntities.length > 0 ? { truncatedEntities } : {}),
		...(keyword !== undefined ? { searchedKeyword: keyword } : {}),
		...(since !== undefined ? { searchedSince: since } : {}),
		...(until !== undefined ? { searchedUntil: until } : {}),
		searchedLimit: limit,
		...(warnings.length > 0 ? { warnings } : {}),
	};

	return attachCorrelation(JSON.stringify(response), correlationId);
}
