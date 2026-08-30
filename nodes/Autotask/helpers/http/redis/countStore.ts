import type { RedisLike } from './client';

/**
 * Distributed single-flight store for the tenant-wide company count
 * (`company-domain-search.ts` -> `countCompanyTotal`, issue #144 / PR #150).
 * Mirrors the layout of ./threadStore.ts: the Lua scripts live next to the
 * client, the caller owns the key names and the TTL values.
 *
 * TWO keys with DIFFERENT scopes, deliberately (Codex R3 P1-A on PR #150):
 *
 * - COORDINATION key `n8n-autotask:cnt-pend:{threadHash}` — keyed on the
 *   THREAD-BUDGET identity (`redisKeyHash`, NO username), the same scope as the
 *   `Itgenatr005` 3-slot semaphore in `http/request.ts`. Its job is purely to
 *   SERIALISE execution so at most ONE real count runs per shared budget at any
 *   moment, cluster-wide. It carries an owner claim, never a count.
 * - RESULT key `n8n-autotask:cnt-res:{usageHash}` — keyed on the USAGE identity
 *   (`redisUsageKeyHash`, WITH username). Its job is to hold the published
 *   outcome. A zone URL hosts many tenant databases, so baseUrl + integration code
 *   alone does NOT identify a database (`redisUsageKeyHash` doc in ./client.ts);
 *   publishing counts under the thread identity would let one credential read
 *   another database's total. Splitting the keys keeps the serialisation shared
 *   (which is what protects the thread budget) while keeping the DATA private.
 *
 * Ownership is token-based (Codex R3 P1-C): the marker value is
 * `pending:{ownerToken}:{renewEpochMs}`. The epoch moves on every renewal, so
 * every mutation of the marker is a compare-and-set against either the OWNER
 * PREFIX (renew/release: the epoch legitimately changes under the same owner) or
 * the EXACT FULL VALUE (stale reap: only a marker nobody has touched since we
 * observed it is removable). A slow or orphaned claimant can therefore never
 * delete or clobber a newer owner's marker, and a live owner's marker can never
 * be reaped by a waiter.
 */

/** Value prefix of every coordination-marker claim. */
export const COUNT_PENDING_MARKER_PREFIX = 'pending:';

/**
 * Atomic owner-scoped renewal: if the marker is still ours, publish the new
 * epoch AND extend the TTL in one atomic step.
 * KEYS[1] = coordination key
 * ARGV[1] = owner prefix (`pending:{ownerToken}:`)  ARGV[2] = new full value
 * ARGV[3] = TTL (ms)
 * Returns 1 when renewed, 0 when we no longer own the marker.
 */
const RENEW_SCRIPT = `
-- cas:renew
local current = redis.call('GET', KEYS[1])
if current and string.sub(current, 1, string.len(ARGV[1])) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0
`;

/**
 * Atomic owner-scoped release: delete the marker iff it is still ours.
 * KEYS[1] = coordination key, ARGV[1] = owner prefix (`pending:{ownerToken}:`).
 * Returns 1 when our claim was released, 0 when a newer owner holds it.
 */
const RELEASE_SCRIPT = `
-- cas:release
local current = redis.call('GET', KEYS[1])
if current and string.sub(current, 1, string.len(ARGV[1])) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

/**
 * Atomic stale-claim reap: delete the marker iff it still holds the EXACT value
 * a waiter observed as stale. A renewal between the observation and this call
 * changes the value (the epoch moves), so the CAS fails and a live owner's
 * marker can never be removed here.
 * KEYS[1] = coordination key, ARGV[1] = the exact stale value observed.
 * Returns 1 when the stale marker was removed, 0 otherwise.
 */
const REAP_STALE_SCRIPT = `
-- cas:reap
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

let counter = 0;
/**
 * Unique owner token for one claimant: pid + per-process counter + hrtime.
 * Same shape as `newMember()` in ./threadStore.ts — uniqueness within a
 * process+time is enough, no uuid needed.
 */
export function newCountOwnerToken(): string {
	counter += 1;
	return `${process.pid}-${counter}-${process.hrtime.bigint().toString()}`;
}

/** Full coordination-marker value: owner + last-renewal epoch. */
export function countClaimValue(ownerToken: string, renewEpochMs: number): string {
	return `${COUNT_PENDING_MARKER_PREFIX}${ownerToken}:${renewEpochMs}`;
}

/** Owner-scoped prefix of a marker value — stable across renewals. */
export function countClaimOwnerPrefix(ownerToken: string): string {
	return `${COUNT_PENDING_MARKER_PREFIX}${ownerToken}:`;
}

/**
 * Last-renewal epoch embedded in a marker value, or `null` when the value is not
 * a well-formed claim (foreign/legacy format). A waiter treats `null` as "cannot
 * judge — keep waiting", never as "stale", so an unrecognised marker is never
 * reaped on a guess.
 */
export function parseClaimRenewEpoch(value: string): number | null {
	// `pending:{ownerToken}:{epoch}` — the owner token itself contains no colons,
	// so a well-formed claim is exactly 3 parts; anything shorter is not a claim.
	const parts = value.split(':');
	if (parts.length < 3 || parts[0] !== 'pending') return null;
	const epoch = Number(parts[parts.length - 1]);
	return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
}

/** Coordination key: shared thread-budget identity, no username. */
export function countPendingKey(threadHash: string): string {
	return `n8n-autotask:cnt-pend:${threadHash}`;
}

/** Result key: per-credential usage identity, WITH username. */
export function countResultKey(usageHash: string): string {
	return `n8n-autotask:cnt-res:${usageHash}`;
}

/**
 * Claim the coordination marker if nobody holds it: `SET NX PX`. Atomic, so two
 * workers racing on one shared thread budget produce exactly one claimant.
 */
export async function claimCount(
	client: RedisLike,
	key: string,
	claimValue: string,
	ttlMs: number,
): Promise<boolean> {
	return (await client.set(key, claimValue, { NX: true, PX: ttlMs })) === 'OK';
}

/**
 * Extend the marker's TTL and move its renewal epoch while our request is still
 * running. Best-effort by design: `false` (or a throw, caught by the caller) only
 * means we lost the claim, and the worst case is a duplicate count later — never
 * a clobber of the new owner.
 */
export async function renewCountClaim(
	client: RedisLike,
	key: string,
	ownerPrefix: string,
	newValue: string,
	ttlMs: number,
): Promise<boolean> {
	const res = await client.eval(RENEW_SCRIPT, {
		keys: [key],
		arguments: [ownerPrefix, newValue, String(ttlMs)],
	});
	return res === 1;
}

/**
 * Release the coordination marker iff it is still ours (owner-prefix CAS). A
 * claimant that ran past its TTL and was re-claimed by another worker drops its
 * claim silently instead of deleting the new owner's marker.
 */
export async function releaseCountClaim(
	client: RedisLike,
	key: string,
	ownerPrefix: string,
): Promise<boolean> {
	const res = await client.eval(RELEASE_SCRIPT, {
		keys: [key],
		arguments: [ownerPrefix],
	});
	return res === 1;
}

/**
 * Remove a marker a waiter judged STALE, iff it still holds the exact value the
 * waiter observed (full-value CAS). See `REAP_STALE_SCRIPT`.
 */
export async function reapStaleCountClaim(
	client: RedisLike,
	key: string,
	observedValue: string,
): Promise<boolean> {
	const res = await client.eval(REAP_STALE_SCRIPT, {
		keys: [key],
		arguments: [observedValue],
	});
	return res === 1;
}
