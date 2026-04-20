import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { QUERY_LIMITS } from '../constants/operations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OutputFieldSpec = string | ((record: Record<string, unknown>) => unknown);

interface HopConfig {
	entityName: string;
	fetchFields: string[];
	outputFields: Record<string, OutputFieldSpec>;
}

interface EnrichmentConfig extends HopConfig {
	nextHop?: HopConfig & { idField: string };
}

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

const ENRICHMENT_TTL_MS = 1_800_000;

interface EnrichmentCacheEntry {
	fields: Record<string, unknown>;
	expiresAt: number;
}

/** Cache of output fields keyed by `${entityName}:${id}` */
const enrichmentCache = new Map<string, EnrichmentCacheEntry>();

/** Cache of raw source records keyed by `raw:${entityName}:${id}` — used for nextHop idField lookup */
const rawCache = new Map<string, EnrichmentCacheEntry>();

const inFlightMap = new Map<string, Promise<Record<string, unknown>[]>>();

// ---------------------------------------------------------------------------
// Enrichment registry
// ---------------------------------------------------------------------------

const ENRICHMENT_REGISTRY: Record<string, EnrichmentConfig> = {
	ticketID: {
		entityName: 'Ticket',
		fetchFields: ['id', 'ticketNumber', 'title'],
		outputFields: { ticketNumber: 'ticketNumber', ticketTitle: 'title' },
	},
	taskID: {
		entityName: 'Task',
		fetchFields: ['id', 'title', 'projectID'],
		outputFields: { taskTitle: 'title' },
		nextHop: {
			entityName: 'Project',
			idField: 'projectID',
			fetchFields: ['id', 'projectNumber', 'projectName'],
			outputFields: { taskProjectNumber: 'projectNumber', taskProjectName: 'projectName' },
		},
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCachedEntry(
	cache: Map<string, EnrichmentCacheEntry>,
	key: string,
): Record<string, unknown> | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		cache.delete(key);
		return undefined;
	}
	return entry.fields;
}

function applyOutputFields(
	sourceRecord: Record<string, unknown>,
	outputFields: Record<string, OutputFieldSpec>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [outKey, spec] of Object.entries(outputFields)) {
		if (typeof spec === 'string') {
			result[outKey] = sourceRecord[spec];
		} else {
			result[outKey] = spec(sourceRecord);
		}
	}
	return result;
}

/**
 * Fetches enrichment fields for a batch of IDs using EntityValueHelper.getValuesByIds().
 * Returns a Map<id, outputFields> of resolved output fields.
 * Also populates rawCache so callers can look up source-record fields (e.g. nextHop idField).
 */
async function fetchEntityFields(
	entityName: string,
	ids: number[],
	fetchFields: string[],
	outputFields: Record<string, OutputFieldSpec>,
	context: IExecuteFunctions | ILoadOptionsFunctions,
	warnings: string[],
	MAX_IN_CLAUSE: number,
): Promise<Map<number, Record<string, unknown>>> {
	const resultMap = new Map<number, Record<string, unknown>>();

	// Check cache for each id
	const uncachedIds: number[] = [];
	for (const id of ids) {
		const cached = getCachedEntry(enrichmentCache, `${entityName}:${id}`);
		if (cached !== undefined) {
			resultMap.set(id, cached);
		} else {
			uncachedIds.push(id);
		}
	}

	if (uncachedIds.length === 0) {
		return resultMap;
	}

	// Truncate if over limit
	if (uncachedIds.length > MAX_IN_CLAUSE) {
		warnings.push(
			`Enrichment truncated: ${entityName} has ${uncachedIds.length} unique IDs, limit is ${MAX_IN_CLAUSE} — first ${MAX_IN_CLAUSE} enriched`,
		);
		uncachedIds.splice(MAX_IN_CLAUSE);
	}

	const batchKey = `batch:${entityName}:${[...uncachedIds].sort((a, b) => a - b).join(',')}`;

	if (!inFlightMap.has(batchKey)) {
		const promise = (async () => {
			const { EntityValueHelper } = await import('./entity-values/value-helper');
			const helper = new EntityValueHelper(
				context as unknown as ILoadOptionsFunctions,
				entityName,
			);
			return (await helper.getValuesByIds(uncachedIds, fetchFields)) as Record<string, unknown>[];
		})().finally(() => inFlightMap.delete(batchKey));
		inFlightMap.set(batchKey, promise);
	}

	let rawResults: Record<string, unknown>[];
	try {
		rawResults = (await inFlightMap.get(batchKey)) ?? [];
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		warnings.push(
			`Enrichment failed for ${entityName} IDs [${uncachedIds.join(', ')}]: ${msg} — enriched fields omitted`,
		);
		return resultMap;
	}

	const expiresAt = Date.now() + ENRICHMENT_TTL_MS;

	for (const rawResult of rawResults) {
		const id = rawResult['id'] as number;
		if (id == null) continue;

		// Cache the raw source record (for nextHop idField lookups)
		rawCache.set(`raw:${entityName}:${id}`, { fields: rawResult, expiresAt });

		// Compute and cache output fields
		const fields = applyOutputFields(rawResult, outputFields);
		enrichmentCache.set(`${entityName}:${id}`, { fields, expiresAt });

		resultMap.set(id, fields);
	}

	return resultMap;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enrichResponseJson(
	responseJson: string,
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<string> {
	try {
		const parsed: Record<string, unknown> = JSON.parse(responseJson);

		// Skip error responses
		if (parsed['error'] === true) {
			return responseJson;
		}

		// Detect shape.
		// NOTE: `items` references the arrays/objects owned by `parsed` directly. Field injection
		// below mutates those records in place. If any exception is thrown mid-mutation and is
		// caught by the outer try/catch, the original (un-stringified) `responseJson` is returned —
		// so partial mutations on the parsed object are never observed by the caller. Safe but
		// worth being explicit about.
		let items: Record<string, unknown>[] | null = null;

		if (Array.isArray(parsed['records'])) {
			items = parsed['records'] as Record<string, unknown>[];
		} else if (
			parsed['record'] !== undefined &&
			parsed['record'] !== null &&
			typeof parsed['record'] === 'object' &&
			!Array.isArray(parsed['record'])
		) {
			items = [parsed['record'] as Record<string, unknown>];
		}

		// If no enrichable shape (count, metadata, ticketSummary, etc.) return as-is
		if (items === null) {
			return responseJson;
		}

		const warnings: string[] = [];

		for (const [fieldKey, config] of Object.entries(ENRICHMENT_REGISTRY)) {
			// Collect unique non-null, non-zero IDs from items
			const idSet = new Set<number>();
			for (const item of items) {
				const v = item[fieldKey];
				if (typeof v === 'number' && v > 0) {
					idSet.add(v);
				}
			}

			if (idSet.size === 0) continue;

			const uniqueIds = Array.from(idSet);

			// Fetch first-hop entity fields
			const firstHopMap = await fetchEntityFields(
				config.entityName,
				uniqueIds,
				config.fetchFields,
				config.outputFields,
				context,
				warnings,
				QUERY_LIMITS.MAX_IN_CLAUSE_VALUES,
			);

			// Handle optional second hop
			let nextHopMap: Map<number, Record<string, unknown>> | null = null;
			if (config.nextHop) {
				const { nextHop } = config;
				// Collect unique next-hop IDs by reading raw source records from rawCache
				const nextHopIdSet = new Set<number>();
				for (const id of uniqueIds) {
					const rawRecord = getCachedEntry(rawCache, `raw:${config.entityName}:${id}`);
					if (rawRecord) {
						const nextIdRaw = rawRecord[nextHop.idField];
						if (typeof nextIdRaw === 'number' && nextIdRaw > 0) {
							nextHopIdSet.add(nextIdRaw);
						}
					}
				}

				if (nextHopIdSet.size > 0) {
					nextHopMap = await fetchEntityFields(
						nextHop.entityName,
						Array.from(nextHopIdSet),
						nextHop.fetchFields,
						nextHop.outputFields,
						context,
						warnings,
						QUERY_LIMITS.MAX_IN_CLAUSE_VALUES,
					);
				}
			}

			// Inject enriched fields into each item
			for (const item of items) {
				const v = item[fieldKey];
				if (typeof v !== 'number' || v <= 0) continue;

				// Inject first-hop output fields
				const firstHopFields = firstHopMap.get(v);
				if (firstHopFields) {
					for (const [k, val] of Object.entries(firstHopFields)) {
						if (!(k in item)) {
							item[k] = val;
						}
					}
				}

				// Inject next-hop output fields
				if (nextHopMap && config.nextHop) {
					const rawRecord = getCachedEntry(rawCache, `raw:${config.entityName}:${v}`);
					if (rawRecord) {
						const nextId = rawRecord[config.nextHop.idField];
						if (typeof nextId === 'number' && nextId > 0) {
							const nextHopFields = nextHopMap.get(nextId);
							if (nextHopFields) {
								for (const [k, val] of Object.entries(nextHopFields)) {
									if (!(k in item)) {
										item[k] = val;
									}
								}
							}
						}
					}
				}
			}
		}

		if (warnings.length > 0) {
			// Response builders always initialise `warnings: []`, so this array is guaranteed to exist.
			(parsed['warnings'] as unknown[]).push(...warnings);
		}

		return JSON.stringify(parsed);
	} catch {
		return responseJson;
	}
}
