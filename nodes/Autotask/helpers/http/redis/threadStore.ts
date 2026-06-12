import type { RedisLike } from './client';

/**
 * Atomic acquire: evict expired leases, then add our lease iff under the limit.
 * KEYS[1] = semaphore key
 * ARGV[1] = now (ms)         ARGV[2] = leaseExpiry score (now + leaseMs)
 * ARGV[3] = limit            ARGV[4] = member (uuid)
 * ARGV[5] = whole-key safety TTL (ms)
 * Returns 1 if acquired, 0 if full.
 */
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
  return 1
end
return 0
`;

let counter = 0;
function newMember(): string {
	// uuid not required — uniqueness within a process+time is enough; vary by counter+hrtime.
	counter += 1;
	return `${process.pid}-${counter}-${process.hrtime.bigint().toString()}`;
}

export interface AcquireResult {
	acquired: boolean;
	member: string;
}

/**
 * Attempts to acquire one concurrency lease on `key`.
 * @param leaseMs lease lifetime; the lease score = now + leaseMs (use <=0 in tests to pre-expire)
 * @param keyTtlMs whole-key safety TTL (should exceed leaseMs)
 */
export async function acquireThreadSlot(
	client: RedisLike,
	key: string,
	limit: number,
	leaseMs: number,
	keyTtlMs: number,
): Promise<AcquireResult> {
	const now = Date.now();
	const member = newMember();
	const res = await client.eval(ACQUIRE_SCRIPT, {
		keys: [key],
		arguments: [
			String(now),
			String(now + leaseMs),
			String(limit),
			member,
			String(keyTtlMs),
		],
	});
	return { acquired: res === 1, member };
}

/** Releases a previously-acquired lease. Idempotent (ZREM of an absent member is a no-op). */
export async function releaseThreadSlot(
	client: RedisLike,
	key: string,
	member: string,
): Promise<void> {
	await client.zRem(key, member);
}
