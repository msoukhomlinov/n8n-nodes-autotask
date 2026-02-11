import type { IExecuteFunctions } from 'n8n-workflow';
import { createHash } from 'node:crypto';
import { initializeCache } from './init';
import type { CacheService } from './service';

/**
 * Registry of operations that support API response caching.
 * Keys are compared case-insensitively.
 */
export const CACHEABLE_API_RESPONSE_OPERATIONS: ReadonlyArray<{ resource: string; operation: string }> = [
	{ resource: 'resource', operation: 'whoAmI' },
	{ resource: 'resource', operation: 'get' },
	{ resource: 'resource', operation: 'getMany' },
];

function isCacheable(resource: string, operation: string): boolean {
	const resourceKey = resource.toLowerCase();
	const operationKey = operation.toLowerCase();

	return CACHEABLE_API_RESPONSE_OPERATIONS.some(
		(entry) =>
			entry.resource.toLowerCase() === resourceKey &&
			entry.operation.toLowerCase() === operationKey,
	);
}

/**
 * Create a stable hash of an object for use in cache keys.
 */
function hashObject(obj: unknown): string {
	const json = JSON.stringify(obj, Object.keys(obj as object).sort());
	return createHash('sha256').update(json).digest('hex').substring(0, 16);
}

/**
 * Get a versioned cache key for an API response.
 */
function getResponseCacheKey(
	cacheService: CacheService,
	resource: string,
	operation: string,
	keySuffix?: string,
): string {
	return cacheService.getResponseKey(resource, operation, keySuffix);
}

/**
 * Wrap an API call with optional response caching based on node parameters.
 *
 * - Caching is only applied when:
 *   - The (resource, operation) pair is in CACHEABLE_API_RESPONSE_OPERATIONS
 *   - The node parameter `cacheResponse` is true
 *   - A CacheService instance can be initialised (field caching enabled in credentials)
 *
 * On any cache initialisation failure, this helper logs a debug message and falls back to a direct API call.
 */
export async function getCachedOrFetch<T>(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	itemIndex: number,
	keySuffix: string | undefined,
	fetchFn: () => Promise<T>,
): Promise<T> {
	// Fast path: operation not registered as cacheable
	if (!isCacheable(resource, operation)) {
		return fetchFn();
	}

	// Read per-node configuration
	const cacheResponse = context.getNodeParameter('cacheResponse', itemIndex, false) as boolean;
	const cacheTtl = context.getNodeParameter('cacheTtl', itemIndex, 900) as number;

	if (!cacheResponse) {
		return fetchFn();
	}

	// Validate TTL to catch configuration issues
	if (typeof cacheTtl !== 'number' || cacheTtl < 0) {
		console.warn(`[response-cache] Invalid cacheTtl value: ${cacheTtl}, falling back to API call`);
		return fetchFn();
	}

	// Initialise cache – this will respect credential-level cache settings
	let cacheService: CacheService | undefined;
	try {
		cacheService = await initializeCache(context);
	} catch (error) {
		console.debug(
			'[response-cache] Failed to initialize CacheService, falling back to direct API call:',
			error,
		);
		return fetchFn();
	}

	if (!cacheService) {
		console.debug(
			'[response-cache] CacheService not available (field caching may be disabled in credentials); falling back to direct API call.',
		);
		return fetchFn();
	}

	// Include TTL in cache key so different TTL values use separate cache entries.
	// This prevents stale data when TTL is reduced (e.g., from 3600s to 60s).
	const keySuffixWithTtl = keySuffix ? `${keySuffix}:ttl${cacheTtl}` : `ttl${cacheTtl}`;
	const key = getResponseCacheKey(cacheService, resource, operation, keySuffixWithTtl);

	try {
		const cached = await cacheService.get<T>(key);
		if (cached !== undefined) {
			console.debug(
				`[response-cache] Returning cached value for key '${key}' (TTL was ${cacheTtl}s)`,
			);
			return cached;
		}
	} catch (error) {
		console.debug(
			`[response-cache] Error reading from cache for key '${key}', proceeding with API call:`,
			error,
		);
	}

	// Cache miss or read error – call API
	const result = await fetchFn();

	try {
		console.debug(
			`[response-cache] Caching API response for key '${key}' with TTL ${cacheTtl}s (${cacheTtl * 1000}ms)`,
		);
		await cacheService.set(key, result, cacheTtl);
	} catch (error) {
		console.debug(
			`[response-cache] Error writing to cache for key '${key}', result will not be cached:`,
			error,
		);
	}

	return result;
}

/**
 * Helper to create a cache key suffix by hashing filter parameters.
 * Use this for getMany operations where the result depends on filter criteria.
 */
export function createFilterCacheKeySuffix(filters: unknown): string {
	return hashObject(filters);
}

