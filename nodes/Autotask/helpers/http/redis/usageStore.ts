import type { RedisLike } from './client';
import { REDIS_KEY_PREFIX } from './client';

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
