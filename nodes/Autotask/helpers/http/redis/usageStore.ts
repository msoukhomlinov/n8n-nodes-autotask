import type { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions, ISupplyDataFunctions } from 'n8n-workflow';
import type { RedisLike } from './client';
import { REDIS_KEY_PREFIX, getRedisConfigFromCredentials, getRedisClient, redisUsageKeyHash } from './client';
import type { IAutotaskCredentials } from '../../../types/base/auth';

export interface SharedUsage {
	externalRequestThreshold: number;
	requestThresholdTimeframe: number;
	currentTimeframeRequestCount: number;
	syncedAt: number;
}

function pollKey(hash: string): string {
	return `${REDIS_KEY_PREFIX}:poll:${hash}`;
}
function usageKey(hash: string): string {
	return `${REDIS_KEY_PREFIX}:usage:${hash}`;
}

/**
 * Returns true if this caller won the poll lock (i.e. nobody polled within `windowMs`).
 * Implemented as SET key 1 NX PX windowMs — one round-trip, no Lua, no winner election.
 */
export async function tryAcquirePollLock(
	client: RedisLike,
	hash: string,
	windowMs: number,
): Promise<boolean> {
	const res = await client.set(pollKey(hash), '1', { NX: true, PX: windowMs });
	return res === 'OK';
}

/** Stores the latest ThresholdInformation snapshot for cluster-wide reads. */
export async function writeUsage(
	client: RedisLike,
	hash: string,
	usage: SharedUsage,
	ttlMs: number,
): Promise<void> {
	await client.set(usageKey(hash), JSON.stringify(usage), { PX: ttlMs });
}

/** Reads the shared usage snapshot, or null if absent/unparseable. */
export async function readUsage(client: RedisLike, hash: string): Promise<SharedUsage | null> {
	const raw = await client.get(usageKey(hash));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as SharedUsage;
	} catch {
		return null;
	}
}

/**
 * Best-effort read of the cluster-wide ThresholdInformation snapshot for the given
 * execution context's credentials. Resolves Redis fail-open (returns null when Redis
 * is disabled, unconfigured, unhealthy, or the snapshot is absent), and computes the
 * SAME poll/usage identity the poller writes under in request.ts — normalised baseUrl +
 * integration code + Username (see redisUsageKeyHash). Any throw degrades to null so
 * callers can fall through to a direct API fetch.
 *
 * Single source of truth shared by the rate tracker's threshold fetcher and the
 * apiThreshold resource — both must read the same key the poller wrote.
 */
export async function readSharedUsageSnapshot(
	context: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | ISupplyDataFunctions,
): Promise<SharedUsage | null> {
	try {
		const credentials = (await context.getCredentials('autotaskApi')) as IAutotaskCredentials;
		const redisConfig = getRedisConfigFromCredentials(credentials as unknown as Record<string, unknown>);
		if (!redisConfig) return null;
		const redis = await getRedisClient(redisConfig);
		if (!redis) return null;
		const baseUrl = credentials.zone === 'other' ? credentials.customZoneUrl || '' : credentials.zone;
		// Writer normalises baseUrl (strips trailing slash[es]) before hashing — reader MUST too.
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
		const hash = redisUsageKeyHash(
			normalizedBaseUrl,
			String(credentials.APIIntegrationcode ?? ''),
			String(credentials.Username ?? ''),
		);
		return await readUsage(redis, hash);
	} catch {
		return null;
	}
}
