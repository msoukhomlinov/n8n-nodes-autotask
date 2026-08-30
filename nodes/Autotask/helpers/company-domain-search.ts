import type { IDataObject, IExecuteFunctions, IGetNodeParameterOptions } from 'n8n-workflow';
import { CountOperation, GetManyOperation } from '../operations/base';
import type { IAutotaskCredentials, IAutotaskEntity } from '../types';
import type { IFilterCondition } from '../types/base/entity-types';
import { getFields } from './entity/api';
import {
	getRedisClient,
	getRedisConfigFromCredentials,
	invalidateRedisClient,
	redisKeyHash,
	redisUsageKeyHash,
	type RedisLike,
} from './http/redis/client';
import {
	claimCount,
	COUNT_PENDING_MARKER_PREFIX,
	countClaimOwnerPrefix,
	countClaimValue,
	countPendingKey,
	countResultKey,
	newCountOwnerToken,
	parseClaimRenewEpoch,
	reapStaleCountClaim,
	releaseCountClaim,
	renewCountClaim,
} from './http/redis/countStore';

const MAX_DOMAIN_LIMIT = 100;
const DEFAULT_DOMAIN_LIMIT = 25;
const MAX_CONTACT_FALLBACK_LIMIT = 500;

/**
 * ENTRY deadline for the whole `countCompanyTotal` workflow (issue #144).
 * Measured from function ENTRY and raced against the ENTIRE
 * pipeline — credential scoping, every Redis command, the claim/wait loop and the
 * real count request — not just the request promise.
 *
 * A half-open or overloaded Redis connection has no command timeout of its own
 * (`RedisLike.get` supplies none and the client config sets none), so a deadline
 * started *after* the Redis round-trips could still be held open indefinitely by a
 * jammed GET — the exact unbounded stall inside `buildSearchCoverage()` that this
 * fix exists to remove. Every internal poll consumes the REMAINING entry budget,
 * never a fresh 10s.
 *
 * The count is purely informational coverage context (`totalAvailable`), so
 * exceeding the bound degrades to `undefined` through the same failure-tolerant
 * path already used for outright errors. The underlying request is NOT cancelled:
 * it keeps running, keeps its claim renewed, and still publishes its outcome for
 * whoever reads the result key next.
 */
const COMPANY_TOTAL_COUNT_TIMEOUT_MS = 10_000;
const COUNT_TIMEOUT_SENTINEL = Symbol('countCompanyTotal:timeout');

/**
 * TWO Redis keys with DIFFERENT scopes, by design; both builders live in
 * `http/redis/countStore.ts` next to the Lua scripts:
 *
 * - `n8n-autotask:cnt-pend:{threadHash}` — COORDINATION, keyed on the same
 *   thread-budget identity as the `Itgenatr005` 3-slot semaphore in
 *   `http/request.ts` (`redisKeyHash`, NO username). Carries only an owner claim
 *   (`pending:{ownerToken}`), never a count. Sharing it is the POINT: two API
 *   users on one integration code share one thread budget, so they must be
 *   serialised against each other rather than each stacking its own count.
 * - `n8n-autotask:cnt-res:{usageHash}` — RESULT, keyed on the usage identity
 *   (`redisUsageKeyHash`, WITH username). A zone URL hosts many tenant databases,
 *   so baseUrl + integration code alone does NOT identify a database
 *   (`redisUsageKeyHash` doc in `http/redis/client.ts`); publishing totals under
 *   the thread identity would disclose one credential's numbers to another.
 *   Serialisation stays shared, the DATA stays private.
 */
/**
 * TTL of the in-flight coordination marker. With renewal in force this is a
 * CRASH-RECOVERY bound, not a request bound: a live claimant
 * renews it every `COUNT_RENEW_MS` for the FULL request lifecycle, so it cannot
 * expire while its owner is still working. It only bites once the owner is gone —
 * a crashed worker stops renewing, the marker expires at the TTL, and the next
 * caller re-claims. It still sits above the 330 s thread lease, which sits above
 * Autotask's 300 s REST execution timeout, so a marker never expires while the
 * slot it represents is provably still busy.
 */
const COUNT_PENDING_TTL_MS = 360_000;
/**
 * Renewal cadence for a live claimant: 6x under the pending TTL, so five
 * consecutive missed or jammed renewals still hold the claim.
 */
const COUNT_RENEW_MS = 60_000;
/**
 * Hard per-ATTEMPT bound on ONE `renewCountClaim` EVAL.
 *
 * Decoupling the JS timers — each tick schedules the next BEFORE awaiting its
 * renewal — is not by itself enough to make the attempts independent, because they
 * are not independent at the TRANSPORT: `getRedisClient` hands every caller for
 * one credential the SAME node-redis client, i.e. ONE socket whose commands and
 * replies are queued FIFO. A half-open connection (peer stops replying, no error
 * and no close event) parks the first EVAL forever, and every later tick's EVAL
 * queues behind it. Timers keep firing, no renewal ever reaches Redis, the marker
 * expires at its 360 s TTL, and another worker claims it while this count is
 * still running. Bounding each attempt and then FORCING the shared connection out
 * of the registry (`invalidateRedisClient`) is what actually restores
 * independence: the wedged socket is torn down instead of accumulating a queue,
 * and the next `getRedisClient` for that credential builds a fresh one.
 *
 * 10 s, i.e. 6x under the 60 s cadence: a healthy Redis answers an EVAL in
 * sub-millisecond time and even a badly overloaded one is orders of magnitude
 * inside this, so a merely SLOW server is never torn down; while a genuinely hung
 * connection is detected within its FIRST cycle rather than after several wasted
 * 60 s rounds. Same order as the connect bound (3 s) and the caller's entry
 * deadline (10 s) — the scale this file already treats as "no healthy Redis is
 * ever this slow".
 *
 * ACCEPTED WORST CASE: once the connection is invalidated, THIS loop's captured
 * `redis` reference is a destroyed object for the remainder of the request. Its
 * later ticks fail FAST (node-redis rejects on a closed client) instead of
 * hanging — which is the point — but they no longer renew, so the marker may
 * still expire and be reaped/re-claimed by another worker, producing at most a
 * duplicate count. That is the SAME worst case this mechanism already accepts for
 * a crashed claimant (see the pending-TTL doc above and the crash-variant test):
 * renewal is advisory throughout. The job of this bound is to cap the damage and
 * let the SYSTEM self-heal — not to keep one in-flight loop alive across an
 * indefinitely dead socket.
 */
const COUNT_RENEW_TIMEOUT_MS = 10_000;
/**
 * Stale-claim reap threshold: a coordination marker whose
 * embedded renewal epoch is older than this belongs to a claimant that has
 * stopped renewing — dead, or wedged far past any legitimate lifetime — so a
 * waiter may CAS-delete the exact value it observed and take over instead of
 * degrading to `undefined` for the rest of the TTL. It sits ABOVE the 360 s
 * pending TTL and above the full retry+execute horizon (~10 min is the worst
 * documented case, 700 s is the hard cap past which no live owner can be), so
 * a merely SLOW owner is never reaped — it just keeps the caller waiting, and
 * `totalAvailable` is optional context. A live owner moves the epoch every
 * COUNT_RENEW_MS, so its marker can never match the reaped value.
 */
const COUNT_STALE_AFTER_MS = 700_000;
/**
 * TTL of a settled count published on the CLAIMANT'S OWN usage-scoped result
 * key. `totalAvailable` is informational coverage context on a bounded scan, not
 * a billing figure, so a 30 s per-credential window is well inside its accuracy
 * budget while collapsing a burst of searches from ONE API user across queue
 * workers into a single real count.
 */
const COUNT_RESULT_TTL_MS = 30_000;
/**
 * TTL of the negative marker (`err`) on that same usage-scoped result key. Brief
 * on purpose: long enough to stop a retry storm during an outage from re-stacking
 * doomed counts onto the endpoint, short enough to never hide a count that would
 * now succeed.
 */
const COUNT_ERR_TTL_MS = 10_000;
/** Control token on the result key: "the last count for this credential failed". */
const COUNT_ERR_TOKEN = 'err';
/**
 * Non-claimant poll cadence against the COORDINATION key: 250 ms base, doubling
 * per iteration, capped 1 s. The poll waits for the claim to be RELEASED (key
 * gone) or REAPED (stale) — the value it reads off the key is only the owner's
 * claim marker (`pending:{owner}:{epoch}`), which carries no count, so polling
 * never consumes another owner's result.
 */
const COUNT_POLL_BASE_MS = 250;
const COUNT_POLL_MAX_MS = 1000;

const COMPANY_DOMAIN_FIELD_PRIORITY = [
	'webAddress',
	'webaddress',
	'website',
	'websiteUrl',
	'webSiteURL',
	'url',
	'domain',
] as const;

/**
 * Coverage metadata for bounded company scan operations (searchByDomain,
 * searchByIdentity). The scan is a bounded window over the company population —
 * consumers must never read a match (or a no-match) as proof about companies
 * outside the scanned window (C1 fix).
 */
export interface CompanySearchCoverage extends IDataObject {
	/**
	 * Number of records returned by the bounded filtered queries that feed the
	 * result set (the rows actually evaluated client-side). NOT the tenant-wide
	 * company population.
	 */
	scanned: number;
	/**
	 * Total number of companies, from ONE count call on company with no filter.
	 * Informational context only — the tenant-wide population, not a denominator
	 * for scan completeness (Codex P2). Omitted when the count call fails.
	 */
	totalAvailable?: number;
	/**
	 * True only when every bounded filtered query that feeds the result set
	 * returned BELOW its cap AND the derived candidate set (distinct companies
	 * / ranked candidates) was NOT sliced at `limit` — i.e. the filtered search
	 * is complete and no matching record (raw rows or derived candidates) was
	 * truncated away. A selective search with one match below its cap is
	 * complete even in a 10,000-company tenant (Codex P2: completeness comes
	 * from the filtered queries' cap semantics, never from
	 * matches-vs-tenant-population). B1: the derived candidate slice is part of
	 * this verdict — a set of >limit candidates sliced down to `limit` is
	 * truncation, even when every raw query came back below its cap.
	 */
	windowComplete: boolean;
	/**
	 * Present when the DERIVED candidate set was sliced at `limit` (B1): the
	 * published result is capped by that slice even though every raw filtered
	 * query may have been below its cap. Human-readable, truthful description
	 * of the truncating stage — the dispatch layer renders it in the PARTIAL
	 * summary instead of the raw-cap wording, and publishes it at the root.
	 */
	truncationNote?: string;
}

/**
 * Module-level single-flight join map for the REAL (unraced) count request,
 * keyed on the PER-CREDENTIAL USAGE identity — `redisUsageKeyHash(normalizedBaseUrl,
 * APIIntegrationcode, Username)` — i.e. the SAME identity the usage/poll keys use
 * (`http/redis/client.ts`), deliberately NOT the username-less thread-budget hash.
 *
 * Two different identities, two different jobs:
 * - the THREAD-BUDGET identity (`redisKeyHash`, no username) governs
 *   COORDINATION — who may have a count in flight on the shared `Itgenatr005`
 *   budget. That scope lives in the Redis coordination marker, because the budget
 *   is shared cluster-wide and two API users on one integration code must not
 *   stack parallel counts on it.
 * - the USAGE identity (with username) governs RESULTS. A zone URL hosts many
 *   tenant databases, so baseUrl + integration code alone does not identify a
 *   database; a map keyed on the thread identity would hand credential B the
 *   count of a different database (cross-tenant metadata disclosure). So a
 *   caller joins an in-flight promise ONLY when it is the SAME credential as the
 *   claimant, and the published value lands on that claimant's own usage-scoped
 *   Redis key. Different credentials under one budget are serialised (never
 *   parallel) but each runs and reads its OWN count.
 *
 * Why the map at all: the entry-deadline race only stops OUR code from waiting —
 * it does not cancel the underlying HTTP request or free the Company-endpoint
 * slot it holds (3 concurrent requests per endpoint, per Autotask's post-2023.1
 * integration limit). On a slow tenant, retrying the same search a few times
 * previously spawned a fresh real count request each time — each holding a slot
 * for its full ~5-minute real duration — until all 3 Company slots were exhausted
 * and the bounded scans that also need the `company` endpoint stalled too
 * (issue #144).
 *
 * With Redis enabled this map is the SAME-PROCESS, SAME-CREDENTIAL fast join: the
 * claimant registers its promise here, so further callers in this process join it
 * directly without another Redis round-trip. Cross-process coordination is the
 * `n8n-autotask:cnt-pend:{threadHash}` marker; cross-process results are shared
 * only through the claimant's own `n8n-autotask:cnt-res:{usageHash}` key.
 */
const countInFlightMap = new Map<string, Promise<number | undefined>>();

/**
 * Resolve the three things the distributed single-flight needs:
 * - `threadIdentity` — the thread-budget hash (NO username): the COORDINATION
 *   scope, byte-identical to the semaphore's `threadHash` in `http/request.ts`.
 * - `usageIdentity` — the per-credential hash (WITH username): the RESULT scope,
 *   used for the same-process join map and the published value.
 * - `redis` — a client for the credential's Redis, or `null` when Redis is
 *   disabled/unhealthy.
 *
 * Base-URL resolution and normalisation are byte-identical to
 * `autotaskApiRequest`'s (`zone === 'other' ? customZoneUrl : zone`, trailing
 * slashes stripped) and feed BOTH hashes, so the coordination identity is the
 * SAME hash the semaphore uses — that equivalence is the whole point: the count
 * shares the exact budget scope the semaphore protects, never a narrower one.
 *
 * Fail-open: any failure (unreadable credentials, missing zone, Redis down)
 * returns all-null and the caller falls back to the in-process map (or to a
 * direct call when even the identities are unavailable). Scoping must never be
 * the reason a search fails.
 *
 * `getRedisClient`'s first connect can take up to ~3 s and is awaited INSIDE the
 * caller's entry-deadline race, so a slow first connect degrades that caller to
 * `undefined` instead of stretching the bound.
 */
async function resolveCountScoping(context: IExecuteFunctions): Promise<{
	threadIdentity: string | null;
	usageIdentity: string | null;
	redis: RedisLike | null;
}> {
	try {
		const credentials = (await context.getCredentials('autotaskApi')) as IAutotaskCredentials;
		const baseUrl = credentials.zone === 'other' ? credentials.customZoneUrl || '' : credentials.zone;
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
		if (!normalizedBaseUrl) {
			return { threadIdentity: null, usageIdentity: null, redis: null };
		}
		const integrationCode = String(credentials.APIIntegrationcode ?? '');
		const threadIdentity = redisKeyHash(normalizedBaseUrl, integrationCode);
		const usageIdentity = redisUsageKeyHash(
			normalizedBaseUrl,
			integrationCode,
			String(credentials.Username ?? ''),
		);
		const redisConfig = getRedisConfigFromCredentials(credentials as unknown as Record<string, unknown>);
		const redis = redisConfig ? await getRedisClient(redisConfig) : null;
		return { threadIdentity, usageIdentity, redis };
	} catch {
		return { threadIdentity: null, usageIdentity: null, redis: null };
	}
}

/**
 * Read a published count value off the RESULT key. Control tokens are rejected by
 * EXACT literal first (`err`, and the `pending:` marker prefix), then a data
 * value is accepted ONLY if the raw string is a run of ASCII digits — a
 * `parseInt` round-trip on `/^\d+$/`, never `Number(raw)` on an unvalidated
 * string (`Number('') === 0` would fabricate `totalAvailable: 0`, and
 * `Number('1e9')`/`Number(' 5 ')` would launder junk into a count). A genuine
 * count of zero is the literal `'0'` and IS accepted.
 */
function parseCountValue(raw: string | null): number | undefined {
	if (raw === null || raw === COUNT_ERR_TOKEN) return undefined;
	if (raw.startsWith(COUNT_PENDING_MARKER_PREFIX)) return undefined;
	if (!/^\d+$/.test(raw)) return undefined;
	const value = parseInt(raw, 10);
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Best-effort GET: a Redis failure degrades to `null` ("no value") instead of
 * throwing, so Redis latency or an outage can never be the reason a search fails
 * — the caller proceeds to claim, or to the in-process path.
 */
async function safeGet(redis: RedisLike, key: string): Promise<string | null> {
	try {
		return await redis.get(key);
	} catch {
		return null;
	}
}

/**
 * Wait for another worker's claim to be RELEASED, polling the COORDINATION key
 * with a 250 ms base doubling to a 1 s cap. This waits for the key to be GONE;
 * the only value it reads off the key is the owner's claim marker, whose
 * embedded renewal epoch drives the stale reap — the marker carries no count,
 * so waiting never consumes another credential's result (that is the
 * cross-tenant leak the key split closes: results live on per-credential keys).
 *
 * Two exits beyond "gone":
 * - the CALLER'S ENTRY DEADLINE, checked at the TOP of every
 *   iteration, so the loop can never outlive the caller's budget and no timer is
 *   left running past it (at most one in-flight GET may resolve after the
 *   deadline — a dropped no-op);
 * - the STALE-CLAIM REAPER: a marker whose embedded renewal epoch is
 *   older than `COUNT_STALE_AFTER_MS` belongs to a claimant that has stopped
 *   renewing, i.e. is dead or wedged far past any legitimate lifetime. The waiter
 *   then issues a FULL-VALUE CAS delete of the exact value it observed: if the
 *   owner renewed in the meantime the epoch moved, the CAS fails, and the waiter
 *   keeps polling — a live owner's marker can never be removed here. An
 *   unparseable epoch is treated as "cannot judge" and never reaped.
 *
 * Any Redis error degrades to `false` immediately rather than burning the
 * remaining budget.
 */
async function pollForRelease(
	redis: RedisLike,
	pendingKey: string,
	deadline: number,
): Promise<boolean> {
	let delay = COUNT_POLL_BASE_MS;
	for (;;) {
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, COUNT_POLL_MAX_MS);
		if (Date.now() >= deadline) return false;
		let raw: string | null;
		try {
			raw = await redis.get(pendingKey);
		} catch {
			return false;
		}
		if (raw === null) return true;
		const epoch = parseClaimRenewEpoch(raw);
		if (epoch !== null && Date.now() - epoch > COUNT_STALE_AFTER_MS) {
			try {
				if (await reapStaleCountClaim(redis, pendingKey, raw)) return true;
			} catch {
				return false;
			}
		}
	}
}

/**
 * Race a STARTED count against the REMAINING slice of the caller's ENTRY deadline:
 * every path — fresh claim, same-process join, in-process
 * fallback — measures from the SAME `deadline` captured at function entry, so the
 * total time `countCompanyTotal` can consume is bounded by 10 s no matter how much
 * of it was already spent on credential scoping or Redis round-trips. No inner
 * stage is handed a fresh budget.
 *
 * The underlying request is NOT cancelled: it keeps running, keeps its claim
 * renewed, and still publishes its outcome for whoever reads the result key next.
 * Only this caller stops waiting — which is the correct trade for informational
 * coverage context on a bounded scan.
 */
async function raceRemaining(
	promise: Promise<number | undefined>,
	deadline: number,
): Promise<number | undefined> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) return undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<typeof COUNT_TIMEOUT_SENTINEL>((resolve) => {
			timer = setTimeout(() => resolve(COUNT_TIMEOUT_SENTINEL), remaining);
		});
		const raced = await Promise.race([promise, timeoutPromise]);
		return raced === COUNT_TIMEOUT_SENTINEL ? undefined : raced;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The real, unbounded /query/count call. Isolated from the timeout/dedup
 * plumbing so the promise stored in `countInFlightMap` is exactly this request
 * — never re-raced, never duplicated. Failure-tolerant (mirrors the previous
 * catch-all): any error degrades to undefined, so the shared promise NEVER
 * rejects — callers racing a copy of it via Promise.race can never see an
 * unhandled rejection from it.
 *
 * The getNodeParameter override neutralises filtersFromTool / fieldsToMap so
 * the tool call's own filters (or UI resource-mapper fields) can never leak
 * into the total count. Installed on an ISOLATED child context (Object.create)
 * rather than the caller's context: this call runs in parallel with the
 * bounded scans, which install their own overrides on the same shared context.
 * Mutating the shared context let the two override windows clobber each other
 * (Codex NEW-0) — if the count finished while a bounded query was awaiting its
 * API call, the count's finally could clobber the query's override, and the
 * query's finally could subsequently restore the captured count override
 * permanently, so later processing (or the next input item) read neutralised
 * filters and field mappings. Same isolated-context pattern as
 * executeCountOperation (ai-tools/tool-executor-helpers.ts). The shared
 * context is never mutated.
 */
async function runCountCompanyTotalRequest(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<number | undefined> {
	const originalGetNodeParameter = context.getNodeParameter.bind(context);
	const scopedContext = Object.create(context) as IExecuteFunctions;
	scopedContext.getNodeParameter = ((
		name: string,
		index: number,
		fallbackValue?: unknown,
		options?: IGetNodeParameterOptions,
	): unknown => {
		if (name === 'filtersFromTool') return undefined;
		if (name === 'fieldsToMap') return { value: {} };
		return originalGetNodeParameter(name, index, fallbackValue, options);
	}) as IExecuteFunctions['getNodeParameter'];

	try {
		const countOp = new CountOperation<IAutotaskEntity>('company', scopedContext);
		const count = await countOp.execute(itemIndex);
		return typeof count === 'number' && Number.isFinite(count) ? count : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Register a started count in the same-process join map, deleting the entry only
 * when the promise stored there is still the one we registered (a later caller
 * must never have its entry removed by an earlier request's finally).
 */
function trackInFlightCount(
	identity: string,
	sharedPromise: Promise<number | undefined>,
): void {
	countInFlightMap.set(identity, sharedPromise);
	void sharedPromise
		.finally(() => {
			if (countInFlightMap.get(identity) === sharedPromise) {
				countInFlightMap.delete(identity);
			}
		})
		.catch(() => {
			// runCountCompanyTotalRequest never rejects (catch-all above), but the
			// finally-chain itself must never produce an unhandled rejection even if
			// that invariant is ever broken by a future edit.
		});
}

/**
 * ONE renewal attempt under a hard, TRANSPORT-INDEPENDENT bound.
 * The timeout is a plain `setTimeout` race — it cannot be held open by the very
 * socket it is policing, which is the entire difference from relying on the EVAL
 * to settle. On expiry the shared client is force-evicted from the registry so
 * the NEXT `getRedisClient` for this credential reconnects, then the attempt
 * falls through as a failure — the caller treats a timeout exactly like a
 * rejected or `false` renewal, which is why nothing downstream needs to tell
 * them apart.
 */
async function renewAttemptBounded(
	redis: RedisLike,
	pendingKey: string,
	ownerToken: string,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const attempt = renewCountClaim(
			redis,
			pendingKey,
			countClaimOwnerPrefix(ownerToken),
			countClaimValue(ownerToken, Date.now()),
			COUNT_PENDING_TTL_MS,
		);
		const timeoutPromise = new Promise<typeof COUNT_TIMEOUT_SENTINEL>((resolve) => {
			timer = setTimeout(() => resolve(COUNT_TIMEOUT_SENTINEL), COUNT_RENEW_TIMEOUT_MS);
		});
		if ((await Promise.race([attempt, timeoutPromise])) === COUNT_TIMEOUT_SENTINEL) {
			invalidateRedisClient(redis);
		}
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Start the owner-token renewal loop for a live claimant. The
 * fixed pending TTL cannot cover the real lifetime of a count: `executeWithRetry`
 * can spend most of its ~5-minute budget queueing and retrying BEFORE an Autotask
 * request that may itself run for another ~5 minutes, so a static marker expires
 * mid-flight and lets a second worker start a duplicate count on the same busy
 * slot. Renewing every `COUNT_RENEW_MS` for as long as the request is in flight
 * closes that window; the TTL remains purely the crash-recovery bound.
 *
 * Each renewal moves the marker's epoch atomically with the TTL extension, so a
 * waiter's stale-claim reap (full-value CAS) can never remove a marker belonging
 * to an owner that is still renewing.
 *
 * The next tick is scheduled BEFORE awaiting the current renewal, not from its
 * `.finally()`: neither `RedisLike` nor the client config gives
 * `renewCountClaim`'s EVAL a command timeout, so a half-open connection can leave
 * one renewal pending indefinitely. Scheduling from `.finally()` would then stall
 * every later tick too, letting the marker expire under a still-live claimant.
 *
 * That timer-level decoupling is necessary but NOT sufficient: the
 * ticks still share ONE node-redis client, i.e. one socket with a FIFO command
 * queue, so a first EVAL that never gets a reply parks every later EVAL behind it
 * and no renewal reaches Redis at all. `renewAttemptBounded` therefore gives each
 * attempt its own hard deadline and, on expiry, evicts the shared connection from
 * the client registry so the transport itself stops being the shared stall point
 * — see `COUNT_RENEW_TIMEOUT_MS` for the constant and the accepted worst case.
 *
 * Returns a `stop` handle. Renewal is best-effort: a failed, thrown, or
 * timed-out EVAL all mean the same thing — we may have lost the claim — and the
 * loop keeps trying until the request settles. Nothing here can reject: the whole
 * chain ends in `.catch()`.
 */
function startCountRenewal(
	redis: RedisLike,
	pendingKey: string,
	ownerToken: string,
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const tick = () => {
		if (stopped) return;
		timer = setTimeout(tick, COUNT_RENEW_MS);
		void renewAttemptBounded(redis, pendingKey, ownerToken).catch(() => {
			// Renewal is advisory: losing it costs at most a duplicate count later.
		});
	};
	timer = setTimeout(tick, COUNT_RENEW_MS);
	return () => {
		stopped = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}

/**
 * Publish a settled count (or the `err` token) on this credential's OWN
 * usage-scoped result key. Plain SET, never NX: it is this credential's key, so
 * overwriting its own previous value is the point — and no other credential ever
 * reads it.
 */
async function publishCountResult(
	redis: RedisLike,
	resultKey: string,
	count: number | undefined,
): Promise<void> {
	const value = count === undefined ? COUNT_ERR_TOKEN : String(count);
	const ttl = count === undefined ? COUNT_ERR_TTL_MS : COUNT_RESULT_TTL_MS;
	await redis.set(resultKey, value, { PX: ttl });
}

/**
 * Run the real count as the cluster-wide claimant: register the same-process join,
 * renew the claim for the full request lifetime, and on settle publish the outcome
 * on this credential's result key and CAS-release the coordination marker.
 *
 * INVARIANT: this request runs under the CLAIMANT's context + itemIndex, so its
 * outcome is a pure
 * function of the CLAIMANT's own credentials — `runCountCompanyTotalRequest`
 * neutralises every caller-specific input (the scoped override forces
 * `filtersFromTool=undefined` / `fieldsToMap={}`), `company` is a root entity (no
 * parent lookup), and `CountOperation` passes no `impersonationResourceId`. That
 * outcome is now consumed by exactly two audiences, both credential-scoped: the
 * SAME credential's same-process joiners (the usage-keyed `countInFlightMap`) and
 * the claimant's OWN `n8n-autotask:cnt-res:{usageHash}` key. A different
 * credential never receives it — it only shares the serialisation point, then runs
 * and reads its own count. If the outcome ever stops being a pure function of the
 * claimant's credentials, it must be re-keyed per caller before publishing.
 *
 * The publish happens BEFORE the release, so a waiter that observes the marker
 * disappear can always find the value on the result key. Both are best-effort: a
 * failed publish only means other callers re-claim later, it must never turn into
 * a failed search.
 */
async function runAsClaimant(
	context: IExecuteFunctions,
	itemIndex: number,
	redis: RedisLike,
	pendingKey: string,
	resultKey: string,
	ownerToken: string,
	deadline: number,
): Promise<number | undefined> {
	// KNOWN NIT, accepted not fixed: this API path performs a SECOND
	// `getCredentials('autotaskApi')` further down (runCountCompanyTotalRequest ->
	// CountOperation.execute -> autotaskApiRequest). It is a cheap n8n credential
	// CACHE lookup, not a second vault read, and it is preserved deliberately:
	// threading the already-resolved credentials through would mean modifying
	// `runCountCompanyTotalRequest`, the #142-isolated request mechanism this fix
	// keeps verbatim.
	const sharedPromise = runCountCompanyTotalRequest(context, itemIndex);
	trackInFlightCount(resultKey, sharedPromise);
	const stopRenewal = startCountRenewal(redis, pendingKey, ownerToken);

	void sharedPromise
		.then((count) => publishCountResult(redis, resultKey, count).catch(() => undefined))
		.catch(() => {
			// Publish is advisory; swallow so it can never reject unobserved.
		})
		.finally(() => {
			stopRenewal();
			void releaseCountClaim(redis, pendingKey, countClaimOwnerPrefix(ownerToken)).catch(
				() => {
					// Release is advisory: the TTL is the backstop if it is lost.
				},
			);
		});

	return await raceRemaining(sharedPromise, deadline);
}

/**
 * In-process single-flight (Redis disabled/unhealthy, or the identities cannot be
 * resolved). Same-credential callers join the one in-flight request; a caller with
 * no usable identity at all runs its own unshared request (the #142 fail-safe:
 * never key a shared cache by anything unreadable).
 */
async function runInProcessCount(
	context: IExecuteFunctions,
	itemIndex: number,
	resultKey: string | null,
	deadline: number,
): Promise<number | undefined> {
	if (resultKey === null) {
		return await raceRemaining(runCountCompanyTotalRequest(context, itemIndex), deadline);
	}
	const existing = countInFlightMap.get(resultKey);
	if (existing) return await raceRemaining(existing, deadline);
	const sharedPromise = runCountCompanyTotalRequest(context, itemIndex);
	trackInFlightCount(resultKey, sharedPromise);
	return await raceRemaining(sharedPromise, deadline);
}

/**
 * The distributed path: read OWN result key → claim the shared coordination marker
 * → run, or wait for the current owner to release and then claim for real.
 *
 * A waiter NEVER consumes another owner's value: the coordination marker carries
 * no count at all — the only value read off it is the owner's claim (for the
 * stale reap) — and the only RESULT value consumed is from the caller's OWN
 * usage-scoped result key (which a same-credential claimant may have published).
 * Once the marker is
 * gone and our own key is still empty, we re-claim and run OUR OWN count against
 * OUR OWN key. The cost is one extra count per distinct
 * credential, still bounded by the serialisation: at most one count per shared
 * thread budget is in flight at any instant.
 */
async function runDistributedCount(
	context: IExecuteFunctions,
	itemIndex: number,
	redis: RedisLike,
	pendingKey: string,
	resultKey: string,
	deadline: number,
): Promise<number | undefined> {
	const cachedRaw = await safeGet(redis, resultKey);
	const cached = parseCountValue(cachedRaw);
	if (cached !== undefined) return cached;
	if (cachedRaw === COUNT_ERR_TOKEN) return undefined;

	for (;;) {
		if (Date.now() >= deadline) return undefined;
		const ownerToken = newCountOwnerToken();
		let claimed = false;
		try {
			claimed = await claimCount(
				redis,
				pendingKey,
				countClaimValue(ownerToken, Date.now()),
				COUNT_PENDING_TTL_MS,
			);
		} catch {
			// Redis unhealthy mid-flight: degrade to the in-process path — but only if
			// the caller's entry deadline hasn't already passed. Past the deadline,
			// starting `runInProcessCount` would still kick off a real, UNCOORDINATED
			// count: the outer race in `countCompanyTotal` stops THIS
			// caller from waiting for it, but the request itself still runs and holds
			// a Company-endpoint slot outside the distributed claim the rest of this
			// function exists to serialise.
			if (Date.now() >= deadline) return undefined;
			return await runInProcessCount(context, itemIndex, resultKey, deadline);
		}

		if (claimed) {
			return await runAsClaimant(
				context,
				itemIndex,
				redis,
				pendingKey,
				resultKey,
				ownerToken,
				deadline,
			);
		}

		// Someone else owns the budget. Re-read OUR OWN key once (a same-credential
		// worker may have published between our GET and our SET), then wait for the
		// release.
		const settledRaw = await safeGet(redis, resultKey);
		const settled = parseCountValue(settledRaw);
		if (settled !== undefined) return settled;
		if (settledRaw === COUNT_ERR_TOKEN) return undefined;

		if (!(await pollForRelease(redis, pendingKey, deadline))) return undefined;

		const afterReleaseRaw = await safeGet(redis, resultKey);
		const afterRelease = parseCountValue(afterReleaseRaw);
		if (afterRelease !== undefined) return afterRelease;
		if (afterReleaseRaw === COUNT_ERR_TOKEN) return undefined;
		// Loop: re-claim, and this time run our own count.
	}
}

/**
 * Total company count from one unfiltered /query/count call, de-duplicated
 * CLUSTER-WIDE and bounded per caller by COMPANY_TOTAL_COUNT_TIMEOUT_MS measured
 * from FUNCTION ENTRY (issue #144).
 *
 * The ENTRY deadline is the outermost construct: the timer starts before any
 * await, and the entire pipeline — credential scoping, every Redis command, the
 * claim/wait loop and the real request — is raced against that ONE timer. No
 * inner stage gets a fresh budget. This is what makes the bound real against a
 * half-open or overloaded Redis, which has no command timeout of its own and
 * could otherwise hold `buildSearchCoverage()` open indefinitely.
 *
 * Three layers, cheapest first:
 * 1. Same-process, SAME-CREDENTIAL join — an in-flight count for this usage
 *    identity is joined directly, no Redis round-trip.
 * 2. Distributed single-flight — through the SAME Redis the thread semaphore uses,
 *    an atomic `SET NX PX` claims `n8n-autotask:cnt-pend:{threadHash}` with an
 *    owner-token value that is RENEWED for the full request lifetime and released
 *    by CAS. The claimant runs the one real count and publishes to its OWN
 *    `n8n-autotask:cnt-res:{usageHash}` key; every other caller waits for the
 *    release, then claims and runs its own count.
 * 3. In-process fallback — Redis disabled/unhealthy or identities unresolvable:
 *    the usage-keyed map alone, or a direct unshared call (#142 precedent).
 *
 * Invariants: at most ONE count is in flight per shared thread budget at any
 * instant (serialisation, not just dedup); a credential only ever READS values
 * published on its OWN usage-scoped result key; no caller waits longer than 10 s
 * from function entry regardless of Redis/queue latency; and marker ownership is
 * CAS-protected so a slow or orphaned claimant can never delete or overwrite a
 * newer owner's claim.
 */
export async function countCompanyTotal(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<number | undefined> {
	// The deadline is captured and its timer started BEFORE any await.
	const deadline = Date.now() + COMPANY_TOTAL_COUNT_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<typeof COUNT_TIMEOUT_SENTINEL>((resolve) => {
		timer = setTimeout(() => resolve(COUNT_TIMEOUT_SENTINEL), COMPANY_TOTAL_COUNT_TIMEOUT_MS);
	});

	const pipeline = (async (): Promise<number | undefined> => {
		const { threadIdentity, usageIdentity, redis } = await resolveCountScoping(context);
		const resultKey = usageIdentity === null ? null : countResultKey(usageIdentity);

		// Layer 1, cheapest first: join an in-flight count for THIS credential that
		// is already running in this process. Keyed on the usage identity, so a
		// different API user never joins (and never sees) it.
		if (resultKey !== null) {
			const inFlight = countInFlightMap.get(resultKey);
			if (inFlight) return await raceRemaining(inFlight, deadline);
		}

		if (redis === null || threadIdentity === null || resultKey === null) {
			// `resolveCountScoping` awaits the first Redis connect, which can itself
			// outlive the entry deadline before degrading to `redis: null` (a stalled
			// handshake that only later fails). Past the deadline, `runInProcessCount`
			// would still start a real, UNCOORDINATED count holding a Company-endpoint
			// slot — for a caller the outer race has already abandoned.
			if (Date.now() >= deadline) return undefined;
			return await runInProcessCount(context, itemIndex, resultKey, deadline);
		}
		return await runDistributedCount(
			context,
			itemIndex,
			redis,
			countPendingKey(threadIdentity),
			resultKey,
			deadline,
		);
	})().catch(() => undefined);

	try {
		const raced = await Promise.race([pipeline, timeoutPromise]);
		return raced === COUNT_TIMEOUT_SENTINEL ? undefined : raced;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A derived candidate set (distinct companies / ranked candidates collected
 * across the bounded scans) that is sliced at `limit` before publication
 * truncates the published result even when every raw filtered query came back
 * below its cap (B1: the client-side slice was invisible to the completeness
 * verdict, so both company search ops could publish a false "complete filtered
 * set … no further calls needed" with hasMore:false while lower-ranked matches
 * were withheld). Callers report the pre-slice candidate count here, with a
 * note naming the truncating stage.
 */
interface DerivedTruncation {
	note: string;
}

/**
 * Build the coverage block. `filterComplete` must reflect the FILTERED queries'
 * cap semantics (every contributing bounded query returned below its cap), not
 * a comparison of match counts with the tenant-wide company total — that
 * comparison made almost every selective search report partial coverage (Codex P2).
 * B1: `derivedTruncation` folds the derived-candidate slice into the verdict —
 * ANY truncation source (raw query cap OR derived slice) yields
 * windowComplete=false, so hasMore/isTruncated and the summary wording (which
 * names the stage via `truncationNote`) can never be false-complete.
 */
async function buildSearchCoverage(
	scanned: number,
	totalAvailablePromise: Promise<number | undefined> | undefined,
	filterComplete: boolean,
	derivedTruncation?: DerivedTruncation,
): Promise<CompanySearchCoverage> {
	const totalAvailable = totalAvailablePromise ? await totalAvailablePromise : undefined;
	let truncationNote = derivedTruncation?.note;
	if (derivedTruncation && !filterComplete) {
		// Both stages truncated. Word it without claiming a RAW cap was hit:
		// the underlying stages' incompleteness may itself come from a nested
		// derived slice (the identity op borrows the domain search's windowComplete).
		const total = totalAvailable !== undefined ? `, tenant total ${totalAvailable}` : '';
		truncationNote =
			`${truncationNote}; the underlying scan stages were not fully complete either (scanned ${scanned} records${total})`;
	}
	return {
		scanned,
		...(totalAvailable !== undefined ? { totalAvailable } : {}),
		windowComplete: filterComplete && !derivedTruncation,
		...(truncationNote ? { truncationNote } : {}),
	};
}

/**
 * Public/consumer email-provider domains. The contact-email fallback is skipped for
 * these because a domain like `gmail.com` belongs to no single company — searching
 * every contact with that address would mass-match unrelated records. AI callers can
 * no longer disable the fallback, so this guard is the safety valve against over-match.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
	'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
	'yahoo.com', 'yahoo.com.au', 'icloud.com', 'me.com', 'aol.com',
	'proton.me', 'protonmail.com', 'msn.com', 'bigpond.com', 'bigpond.net.au',
]);

/**
 * True when the (already-normalised) domain belongs to a public/consumer email
 * provider. Such domains map to no single company, so the contact-email fallback
 * is skipped to avoid mass-matching unrelated contacts.
 */
export function isPublicEmailDomain(domain: string): boolean {
	return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

type DomainOperator = 'eq' | 'beginsWith' | 'endsWith' | 'contains';

interface DomainSearchOptions {
	domain: string;
	companyName?: string;
	domainOperator?: string;
	searchContactEmails?: boolean;
	limit?: number;
	itemIndex?: number;
	selectColumns?: string[];
}

interface IdentitySearchOptions {
	companyName?: string;
	email?: string;
	website?: string;
	limit?: number;
	itemIndex?: number;
	selectColumns?: string[];
}

interface CompanyFrequency extends IDataObject {
	companyId: number | string;
	companyName: string;
	count: number;
}

export interface CompanyDomainResultItem extends IDataObject {
	id: number | string | null;
	companyName: string | null;
	matchSource: 'companyWebsite' | 'contactEmailFallback';
	confidence: number;
	matchedField?: string | null;
	matchedValue?: string | null;
}

export interface UnresolvedSearchDirective extends IDataObject {
	nextAction: string;
	retryKey: string;
	recommendedFilters: string[];
	terminal: boolean;
	hint: string;
	suggestions: string[];
	helpfulOperations: string[];
}

export interface CompanyDomainSearchResult extends IDataObject {
	source: 'companyWebsite' | 'contactEmailFallback' | 'none';
	domainInput: string;
	domainNormalised: string;
	requestedOperator: string;
	appliedCompanyOperator: DomainOperator;
	searchContactEmails: boolean;
	count: number;
	results: CompanyDomainResultItem[];
	/** @deprecated Kept for backwards compatibility with 2.11.x consumers. Prefer results[0].companyName. */
	topCompanyName?: string;
	/** @deprecated Kept for backwards compatibility with 2.11.x consumers. Prefer results[0].id. */
	topCompanyId?: number | string | null;
	matchedContacts?: number;
	matchedCompanies?: number;
	companyFrequencies?: CompanyFrequency[];
	notes?: string[];
	unresolvedSearch?: UnresolvedSearchDirective;
	coverage: CompanySearchCoverage;
}

export interface RankedCompanyCandidate extends IDataObject {
	confidence: number;
	confidenceReason: string;
	matchedSignals: string[];
}

export interface CompanyIdentitySearchResult extends IDataObject {
	source: 'rankedIdentity' | 'none';
	companyNameInput?: string;
	emailInput?: string;
	websiteInput?: string;
	domainNormalised: string;
	count: number;
	results: RankedCompanyCandidate[];
	notes?: string[];
	coverage: CompanySearchCoverage;
}

interface RetryTrackerEntry {
	identifierSignature: string;
	attempts: number;
	lastSeenAt: number;
}

const RETRY_TRACK_TTL_MS = 15 * 60 * 1000;
const RETRY_TRACK_MAX_ENTRIES = 300;
const unresolvedRetryTracker = new Map<string, RetryTrackerEntry>();

function clampLimit(limit: number | undefined, fallback = DEFAULT_DOMAIN_LIMIT): number {
	if (typeof limit !== 'number' || Number.isNaN(limit)) return fallback;
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_DOMAIN_LIMIT);
}

function normaliseDomainInput(value: string): string {
	let normalised = value.trim().toLowerCase();
	normalised = normalised.replace(/^https?:\/\//i, '');
	normalised = normalised.replace(/^www\./i, '');
	normalised = normalised.replace(/\/+$/, '');
	const slashIndex = normalised.indexOf('/');
	if (slashIndex >= 0) {
		normalised = normalised.slice(0, slashIndex);
	}
	const hashIndex = normalised.indexOf('#');
	if (hashIndex >= 0) {
		normalised = normalised.slice(0, hashIndex);
	}
	const queryIndex = normalised.indexOf('?');
	if (queryIndex >= 0) {
		normalised = normalised.slice(0, queryIndex);
	}
	if (normalised.includes('@')) {
		const [, domainPart] = normalised.split('@');
		if (domainPart) normalised = domainPart;
	}
	normalised = normalised.replace(/:\d+$/, '');
	return normalised;
}

function normaliseNameInput(value: string | undefined): string {
	return (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

/**
 * Resolve the effective searchContactEmails flag.
 * Defaults to true when omitted (undefined/null); honours an explicit false (or 0,
 * which some clients coerce booleans to). This is the single source of the runtime
 * default — the schema/description steer the model to keep it true, but a user can
 * still opt into website-only matching by passing false.
 */
export function resolveSearchContactEmailsDefault(value: unknown): boolean {
	return value !== false && value !== 0;
}

function normaliseOperator(operator: string | undefined): DomainOperator {
	const lower = (operator ?? 'contains').trim().toLowerCase();
	if (lower === 'like') return 'contains';
	if (lower === 'eq' || lower === 'beginswith' || lower === 'endswith' || lower === 'contains') {
		if (lower === 'beginswith') return 'beginsWith';
		if (lower === 'endswith') return 'endsWith';
		return lower as DomainOperator;
	}
	return 'contains';
}

function applyTextOperator(value: string, operator: DomainOperator, search: string): boolean {
	const left = value.toLowerCase();
	const right = search.toLowerCase();
	switch (operator) {
		case 'eq':
			return left === right;
		case 'beginsWith':
			return left.startsWith(right);
		case 'endsWith':
			return left.endsWith(right);
		case 'contains':
			return left.includes(right);
		default:
			return false;
	}
}

function buildWebsiteFieldList(companyFieldNames: string[]): string[] {
	const lowerLookup = new Map(companyFieldNames.map((name) => [name.toLowerCase(), name]));
	const ordered: string[] = [];
	for (const field of COMPANY_DOMAIN_FIELD_PRIORITY) {
		const match = lowerLookup.get(field.toLowerCase());
		if (match && !ordered.includes(match)) {
			ordered.push(match);
		}
	}
	for (const name of companyFieldNames) {
		const lower = name.toLowerCase();
		if (ordered.includes(name)) continue;
		if (/(web|website|url|domain)/i.test(lower)) {
			ordered.push(name);
		}
	}
	return ordered;
}

/**
 * Bounded entity query with per-call parameter overrides (returnAll=false,
 * MaxRecords=limit, selectColumns). The overrides are installed on an ISOLATED
 * child context (Object.create) — never on the caller's context — because
 * multiple bounded queries (and the parallel countCompanyTotal) share one
 * execution context. Installing on the shared context let interleaved
 * finally-blocks clobber each other's overrides (Codex NEW-0): a late restore
 * could leave the wrong override active on the shared context, so in-flight
 * parameter reads (pagination, output mode, date handling) and later
 * processing saw the wrong filters, column sets, and field mappings. Each
 * operation now sees exactly its own overrides; the shared context is never
 * mutated (same pattern as executeCountOperation in
 * ai-tools/tool-executor-helpers.ts).
 */
async function runBoundedQuery(
	context: IExecuteFunctions,
	entityType: string,
	itemIndex: number,
	limit: number,
	filters: IFilterCondition[],
	selectColumns: string[],
): Promise<IAutotaskEntity[]> {
	const originalGetNodeParameter = context.getNodeParameter.bind(context);
	const scopedContext = Object.create(context) as IExecuteFunctions;
	scopedContext.getNodeParameter = ((
		name: string,
		index: number,
		fallbackValue?: unknown,
		options?: IGetNodeParameterOptions,
	): unknown => {
		if (name === 'returnAll') return false;
		if (name === 'maxRecords') return limit;
		if (name === 'selectColumns') return selectColumns;
		if (name === 'selectColumnsJson') return JSON.stringify(selectColumns);
		return originalGetNodeParameter(name, index, fallbackValue, options);
	}) as IExecuteFunctions['getNodeParameter'];

	const getManyOp = new GetManyOperation<IAutotaskEntity>(entityType, scopedContext);
	const results = await getManyOp.execute({ filter: filters, MaxRecords: limit }, itemIndex);
	return results.slice(0, limit);
}

function isValidCompanyId(value: unknown): value is string | number {
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value === 'string') return value.trim() !== '';
	return false;
}

/**
 * Completeness for the `id in [...]` company-name resolution stage (Codex
 * NEW-2). The requested ID set is FINITE, so equality with the query cap is
 * NOT truncation: when the requested set fits the MAX_CONTACT_FALLBACK_LIMIT
 * row cap and every requested ID came back from the API, the query has seen
 * everything it could match. Partial exists only when the requested set
 * itself exceeded the cap (IDs beyond the cap were never queried) or at
 * least one requested ID failed to resolve.
 */
function isIdResolutionComplete(
	companyIds: Array<string | number>,
	resolvedCompanies: IAutotaskEntity[],
): boolean {
	if (companyIds.length > MAX_CONTACT_FALLBACK_LIMIT) return false;
	const resolvedIds = new Set<string>();
	for (const company of resolvedCompanies) {
		if (!isValidCompanyId(company.id)) continue;
		resolvedIds.add(String(company.id));
	}
	for (const companyId of companyIds) {
		if (!resolvedIds.has(String(companyId))) return false;
	}
	return true;
}

function buildRetryKey(domain: string, companyName: string, operator: DomainOperator): string {
	return `company.searchByDomain:domain=${domain || '-'}|name=${companyName || '-'}|operator=${operator}`;
}

function cleanupRetryTracker(now: number): void {
	for (const [key, entry] of unresolvedRetryTracker) {
		if (now - entry.lastSeenAt > RETRY_TRACK_TTL_MS) {
			unresolvedRetryTracker.delete(key);
		}
	}
	if (unresolvedRetryTracker.size <= RETRY_TRACK_MAX_ENTRIES) return;
	const orderedByAge = Array.from(unresolvedRetryTracker.entries())
		.sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
	const overflow = unresolvedRetryTracker.size - RETRY_TRACK_MAX_ENTRIES;
	for (let i = 0; i < overflow; i++) {
		unresolvedRetryTracker.delete(orderedByAge[i][0]);
	}
}

function buildUnresolvedDirective(
	domainNormalised: string,
	companyNameNormalised: string,
	appliedCompanyOperator: DomainOperator,
): UnresolvedSearchDirective {
	const retryKey = buildRetryKey(domainNormalised, companyNameNormalised, appliedCompanyOperator);
	const identifierSignature = `${domainNormalised}|${companyNameNormalised}`;
	const now = Date.now();
	cleanupRetryTracker(now);

	const existing = unresolvedRetryTracker.get(retryKey);
	let attempts = 1;
	if (existing && existing.identifierSignature === identifierSignature) {
		attempts = existing.attempts + 1;
	}

	unresolvedRetryTracker.set(retryKey, {
		identifierSignature,
		attempts,
		lastSeenAt: now,
	});

	const terminal = attempts >= 2;
	if (terminal) {
		return {
			nextAction:
				'Stop retrying this identical company domain search. Ask the user for at least one new disambiguator (exact company name, alternate domain, city, or phone) before retrying.',
			retryKey,
			recommendedFilters: ['companyName:eq:<exact name>', 'phone:contains:<digits>', 'city:eq:<city>'],
			terminal: true,
			hint: 'Repeated unresolved search with identical identifiers. Additional input is required.',
			suggestions: [
				'Collect an exact legal company name and retry with companyName + domain.',
				'Ask for an alternate domain (for example billing/helpdesk subdomain).',
				'Use another identifier like city, phone, or account number.',
			],
			helpfulOperations: ['company.getMany', 'contact.getMany'],
		};
	}

	return {
		nextAction:
			'Do not immediately retry the same query. Retry once with additional filters (for example exact company name or city) or ask the user for more identifying details.',
		retryKey,
		recommendedFilters: ['companyName:eq:<exact name>', 'city:eq:<city>', 'phone:contains:<digits>'],
		terminal: false,
		hint: 'No company match found. Provide additional disambiguation before retrying.',
		suggestions: [
			'Provide an exact company name if known.',
			'Try an alternate domain variation.',
			'Add a location or phone-based filter.',
		],
		helpfulOperations: ['company.getMany', 'contact.getMany'],
	};
}

export async function searchCompaniesByDomain(
	context: IExecuteFunctions,
	options: DomainSearchOptions,
): Promise<CompanyDomainSearchResult> {
	const itemIndex = options.itemIndex ?? 0;
	const domainInput = options.domain;
	const companyNameNormalised = normaliseNameInput(options.companyName);
	const domainNormalised = normaliseDomainInput(domainInput);
	const requestedOperator = options.domainOperator ?? 'contains';
	const requestedNormalisedOperator = normaliseOperator(requestedOperator);
	const limit = clampLimit(options.limit);
	const searchContactEmails = resolveSearchContactEmailsDefault(options.searchContactEmails);
	const isPublicDomain = isPublicEmailDomain(domainNormalised);
	const notes: string[] = [];

	if (!domainNormalised) {
		// No search possible: nothing was scanned and no total count is attempted.
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator: 'contains',
			searchContactEmails,
			count: 0,
			results: [],
			notes: ['Domain is empty after normalisation.'],
			unresolvedSearch: buildUnresolvedDirective(domainNormalised, companyNameNormalised, 'contains'),
			coverage: { scanned: 0, windowComplete: false },
		};
	}

	// One unfiltered total count per search call, run in parallel with the bounded
	// scans (C1 fix: consumers must see whether the scan window covers the whole
	// company population). Failure-tolerant — a failed count only degrades the
	// coverage claim, never the search itself.
	const totalAvailablePromise = countCompanyTotal(context, itemIndex);

	const companyFields = await getFields('company', context, { fieldType: 'standard' });
	const companyFieldNames = companyFields.map((field) => field.name);
	const websiteFields = buildWebsiteFieldList(companyFieldNames);
	if (websiteFields.length === 0) {
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator: 'contains',
			searchContactEmails,
			count: 0,
			results: [],
			notes: ['No company website/domain field was detected in entity metadata.'],
			// No search was executed — completeness cannot be claimed (Codex P2).
			coverage: await buildSearchCoverage(0, totalAvailablePromise, false),
		};
	}

	let appliedCompanyOperator = requestedNormalisedOperator;
	if (requestedNormalisedOperator === 'eq') {
		appliedCompanyOperator = 'contains';
		notes.push(
			"Requested operator 'eq' was mapped to 'contains' for company website fields because Autotask stores full URLs (for example https://...).",
		);
	}

	const companyFilterItems = websiteFields.map((fieldName) => ({
		field: fieldName,
		op: appliedCompanyOperator,
		value: domainNormalised,
	}));
	const companyFilters =
		companyFilterItems.length === 1
			? companyFilterItems
			: [{ op: 'or', items: companyFilterItems }];
	const userSelectColumns = options.selectColumns ?? [];
	// If user specified columns, merge with websiteFields so matching still works.
	// If no columns (default), pass [] → API returns all fields.
	const queryColumns =
		userSelectColumns.length > 0
			? Array.from(new Set([...userSelectColumns, 'id', ...websiteFields]))
			: [];
	const companyResults = await runBoundedQuery(
		context,
		'company',
		itemIndex,
		limit,
		companyFilters,
		queryColumns,
	);

	const enrichedResults: CompanyDomainResultItem[] = companyResults.map((company) => {
		let matchedField: string | null = null;
		let matchedValue: string | null = null;
		for (const fieldName of websiteFields) {
			const raw = company[fieldName];
			if (typeof raw !== 'string' || raw.trim() === '') continue;
			if (applyTextOperator(raw, appliedCompanyOperator, domainNormalised)) {
				matchedField = fieldName;
				matchedValue = raw;
				break;
			}
		}

		let resultEntity: IDataObject;
		if (userSelectColumns.length === 0) {
			resultEntity = { ...company };
		} else {
			resultEntity = { id: (company.id as number | string | undefined) ?? null };
			for (const col of userSelectColumns) {
				if (col in company) resultEntity[col] = company[col];
			}
		}

		return {
			...resultEntity,
			id: (company.id as number | string | undefined) ?? null,
			companyName:
				typeof company.companyName === 'string' && company.companyName.trim() !== ''
					? company.companyName
					: null,
			matchSource: 'companyWebsite',
			confidence: 1,
			matchedField,
			matchedValue,
		};
	});

	if (enrichedResults.length > 0) {
		return {
			source: 'companyWebsite',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: enrichedResults.length,
			results: enrichedResults,
			...(notes.length > 0 ? { notes } : {}),
			// Codex P2: the filtered website search is complete iff it returned below
			// its cap — never from matches-vs-tenant-population.
			coverage: await buildSearchCoverage(companyResults.length, totalAvailablePromise, companyResults.length < limit),
		};
	}

	if (!searchContactEmails || isPublicDomain) {
		if (isPublicDomain) {
			notes.push(
				`Domain '${domainNormalised}' is a public email provider; contact-email fallback skipped. Provide a company name or business domain.`,
			);
		} else {
			notes.push(
				'No company website/domain records matched and contact email fallback is disabled.',
			);
		}
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
			// Codex P2: no-match with the filtered website search below its cap is a
			// complete (tenant-wide) no-match, not a partial-window no-match.
			coverage: await buildSearchCoverage(companyResults.length, totalAvailablePromise, companyResults.length < limit),
		};
	}

	let contactOperator: DomainOperator = requestedNormalisedOperator;
	let contactValue = domainNormalised;
	if (requestedNormalisedOperator === 'eq') {
		contactOperator = 'endsWith';
		contactValue = `@${domainNormalised}`;
		notes.push(
			"Requested contact fallback operator 'eq' was mapped to 'endsWith' using '@domain'.",
		);
	}

	const contactLimit = Math.min(Math.max(limit * 10, 50), MAX_CONTACT_FALLBACK_LIMIT);
	const contactFilters = [
		{
			field: 'emailAddress',
			op: contactOperator,
			value: contactValue,
		},
	];
	const contactResults = await runBoundedQuery(
		context,
		'contact',
		itemIndex,
		contactLimit,
		contactFilters,
		['id', 'companyID', 'emailAddress'],
	);

	const companyFrequencyById = new Map<string, { companyId: string | number; count: number }>();
	for (const contact of contactResults) {
		const companyIdRaw = contact.companyID;
		if (!isValidCompanyId(companyIdRaw)) continue;
		const key = String(companyIdRaw);
		const current = companyFrequencyById.get(key);
		if (current) {
			current.count += 1;
		} else {
			companyFrequencyById.set(key, { companyId: companyIdRaw, count: 1 });
		}
	}

	if (companyFrequencyById.size === 0) {
		notes.push('No contacts with a valid companyID were found for the supplied domain.');
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			matchedContacts: contactResults.length,
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
			// Codex NEW-1: the contact scan HITTING its cap means matching contacts
			// beyond the window (with valid companyIDs) may exist, so this no-match
			// claim is only complete when BOTH bounded scans came back below their
			// caps.
			coverage: await buildSearchCoverage(
				companyResults.length,
				totalAvailablePromise,
				companyResults.length < limit && contactResults.length < contactLimit,
			),
		};
	}

	const companyIds = Array.from(companyFrequencyById.values()).map((entry) => entry.companyId);
	const resolvedCompanies = await runBoundedQuery(
		context,
		'company',
		itemIndex,
		Math.min(companyIds.length, MAX_CONTACT_FALLBACK_LIMIT),
		[
			{
				field: 'id',
				op: 'in',
				value: companyIds,
			},
		],
		['id', 'companyName'],
	);

	const companyNameById = new Map<string, string>();
	for (const company of resolvedCompanies) {
		if (!isValidCompanyId(company.id)) continue;
		const companyName = company.companyName;
		if (typeof companyName === 'string' && companyName.trim() !== '') {
			companyNameById.set(String(company.id), companyName.trim());
		}
	}

	const companyFrequencies: CompanyFrequency[] = [];
	for (const { companyId, count } of companyFrequencyById.values()) {
		const companyName = companyNameById.get(String(companyId));
		if (!companyName) continue;
		companyFrequencies.push({
			companyId,
			companyName,
			count,
		});
	}

	companyFrequencies.sort((a, b) => {
		const countDiff = (b.count as number) - (a.count as number);
		if (countDiff !== 0) return countDiff;
		return String(a.companyName).localeCompare(String(b.companyName), 'en-AU');
	});

	if (companyFrequencies.length === 0) {
		notes.push(
			'Contacts matched, but no canonical company names could be resolved from companyID values.',
		);
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			matchedContacts: contactResults.length,
			matchedCompanies: resolvedCompanies.length,
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
			// Codex P2: completeness = every contributing bounded query (website scan,
			// contact scan) returned below its cap, and the id-in[...] resolution
			// stage resolved every requested company ID within its cap (Codex NEW-2:
			// equality with the cap is not truncation for a finite requested set).
			coverage: await buildSearchCoverage(
				companyResults.length + resolvedCompanies.length,
				totalAvailablePromise,
				companyResults.length < limit &&
					contactResults.length < contactLimit &&
					isIdResolutionComplete(companyIds, resolvedCompanies),
			),
		};
	}

	const topCompany = companyFrequencies[0];
	const topCount = topCompany.count as number;
	// B1: the published fallback results are this sorted frequency set sliced at
	// `limit` — a DERIVED truncation that the raw queries' cap semantics do not
	// see. Report the pre-slice candidate count so the completeness verdict and
	// summary wording name this stage when it truncates.
	const derivedTruncation: DerivedTruncation | undefined =
		companyFrequencies.length > limit
			? {
					note: `the derived candidate set (distinct companies from the contact-email fallback) was limited to ${limit} of ${companyFrequencies.length} (limit ${limit}) — raise 'limit' or narrow the search`,
				}
			: undefined;
	const fallbackResults: CompanyDomainResultItem[] = companyFrequencies
		.slice(0, limit)
		.map((companyFrequency) => ({
			id: companyFrequency.companyId as string | number,
			companyName: companyFrequency.companyName as string,
			matchSource: 'contactEmailFallback',
			confidence: Math.max(
				0.01,
				Number(((companyFrequency.count as number) / Math.max(topCount, 1)).toFixed(4)),
			),
			matchedField: 'emailAddress',
			matchedValue: `@${domainNormalised}`,
		}));

	return {
		source: 'contactEmailFallback',
		domainInput,
		domainNormalised,
		requestedOperator,
		appliedCompanyOperator,
		searchContactEmails,
		count: fallbackResults.length,
		results: fallbackResults,
		topCompanyName: topCompany.companyName as string,
		topCompanyId: topCompany.companyId as string | number,
		matchedContacts: contactResults.length,
		matchedCompanies: resolvedCompanies.length,
		companyFrequencies,
		...(notes.length > 0 ? { notes } : {}),
		// Codex P2: completeness = every contributing bounded query (website scan,
		// contact scan) returned below its cap, and the id-in[...] resolution
		// stage resolved every requested company ID within its cap (Codex NEW-2:
		// equality with the cap is not truncation for a finite requested set).
		// B1: AND the derived candidate set (companyFrequencies) was not sliced at
		// `limit` — the derived stage is part of the verdict.
		coverage: await buildSearchCoverage(
			companyResults.length + resolvedCompanies.length,
			totalAvailablePromise,
			companyResults.length < limit &&
				contactResults.length < contactLimit &&
				isIdResolutionComplete(companyIds, resolvedCompanies),
			derivedTruncation,
		),
	};
}

function scoreCompanyCandidate(
	company: IDataObject,
	nameNeedle: string,
	domainNeedle: string,
	websiteFields: string[],
): RankedCompanyCandidate {
	let confidence = 0;
	const matchedSignals: string[] = [];
	let confidenceReason = 'Low confidence';

	if (domainNeedle) {
		for (const fieldName of websiteFields) {
			const raw = company[fieldName];
			if (typeof raw !== 'string' || raw.trim() === '') continue;
			const fieldDomain = normaliseDomainInput(raw);
			if (!fieldDomain) continue;
			if (fieldDomain === domainNeedle) {
				confidence += 90;
				matchedSignals.push(`domainExact:${fieldName}`);
				confidenceReason = 'Exact domain match on company website field';
				break;
			}
			if (fieldDomain.includes(domainNeedle) || domainNeedle.includes(fieldDomain)) {
				confidence += 70;
				matchedSignals.push(`domainPartial:${fieldName}`);
				confidenceReason = 'Partial domain match on company website field';
				break;
			}
		}
	}

	const companyName =
		typeof company.companyName === 'string' ? company.companyName.toLowerCase() : '';
	if (nameNeedle && companyName.includes(nameNeedle)) {
		confidence += companyName === nameNeedle ? 60 : 40;
		matchedSignals.push('companyNameContains');
		if (!domainNeedle) {
			confidenceReason =
				companyName === nameNeedle ? 'Exact company name match' : 'Company name contains match';
		}
	}

	return {
		...company,
		confidence,
		confidenceReason,
		matchedSignals,
	};
}

export async function searchCompaniesByIdentity(
	context: IExecuteFunctions,
	options: IdentitySearchOptions,
): Promise<CompanyIdentitySearchResult> {
	const itemIndex = options.itemIndex ?? 0;
	const limit = clampLimit(options.limit);
	const companyNameInput = options.companyName?.trim() ?? '';
	const emailInput = options.email?.trim() ?? '';
	const websiteInput = options.website?.trim() ?? '';
	const notes: string[] = [];

	// No-signal guard (round-4 L1, shared surface): a call with NONE of
	// companyName / email / website performs ZERO queries, yet the coverage
	// stages below would still initialise their completeness flags to `true`
	// and publish coverage {scanned: 0, windowComplete: true} — "a complete
	// search found nothing" when nothing was searched. The AI-tool surface
	// already rejects this call earlier (OPERATION_CONTRACTS anyOfGroups →
	// precise INVALID_FILTER_CONSTRAINT envelope via validateOperationContract);
	// this guard protects the shared helper itself so the STANDARD node path —
	// which calls searchCompaniesByIdentity directly with no contract
	// validation and all-blank default node fields — rejects the same call
	// before any field fetch, query, or coverage computation. The standard
	// path renders the thrown error through the node's standard error flow
	// (error item on continueOnFail, otherwise NodeOperationError).
	if (companyNameInput === '' && emailInput === '' && websiteInput === '') {
		throw new Error(
			"searchByIdentity requires at least one identity signal — 'companyName' or 'email' or 'website' — none were provided (all signals were blank). No search was run; supply at least one signal and retry.",
		);
	}

	const domainFromEmail = emailInput ? normaliseDomainInput(emailInput) : '';
	const domainFromWebsite = websiteInput ? normaliseDomainInput(websiteInput) : '';
	const domainNormalised = domainFromWebsite || domainFromEmail;

	const userSelectColumns = options.selectColumns ?? [];
	const companyFields = await getFields('company', context, { fieldType: 'standard' });
	const websiteFields = buildWebsiteFieldList(companyFields.map((field) => field.name));
	const selectColumns =
		userSelectColumns.length > 0
			? Array.from(new Set([...userSelectColumns, 'id', 'companyName', ...websiteFields]))
			: [];

	const candidatesById = new Map<string, IDataObject>();

	// Coverage accounting (C1 fix): scanned company records across the bounded
	// queries, plus the population total. On the domain path the total is reused
	// from the nested domain search (one count call per tool call, never two); on
	// a name-only search this function performs the count itself.
	let domainScanned = 0;
	let totalAvailable: number | undefined;
	let countPromise: Promise<number | undefined> | undefined;
	let nameScanned = 0;
	// Codex P2: filtered-query completeness flags for the two scan stages.
	let domainFilterComplete = true;
	let nameFilterComplete = true;

	if (domainNormalised) {
		const domainResults = await searchCompaniesByDomain(context, {
			domain: domainNormalised,
			companyName: companyNameInput || undefined,
			domainOperator: 'contains',
			searchContactEmails: true,
			limit,
			itemIndex,
			selectColumns,
		});
		domainScanned = domainResults.coverage.scanned;
		totalAvailable = domainResults.coverage.totalAvailable;
		domainFilterComplete = domainResults.coverage.windowComplete;

		if (domainResults.source === 'companyWebsite' && domainResults.results.length > 0) {
			for (const result of domainResults.results) {
				const id = result.id;
				if (!isValidCompanyId(id)) continue;
				candidatesById.set(String(id), result);
			}
		} else if (domainResults.source === 'contactEmailFallback') {
			notes.push(
				'Domain matched contacts but not a direct company website field; lowering confidence.',
			);
			for (const entry of domainResults.companyFrequencies ?? []) {
				if (!isValidCompanyId(entry.companyId)) continue;
				candidatesById.set(String(entry.companyId), {
					id: entry.companyId,
					companyName: entry.companyName,
					contactMatchCount: entry.count,
				});
			}
		}
	}

	const hasConfidentDomainMatch = Array.from(candidatesById.values()).length > 0;
	if (companyNameInput) {
		if (hasConfidentDomainMatch) {
			notes.push('Company name search also executed to enrich ranking among domain candidates.');
		} else {
			notes.push('No confident domain match found; using company name contains search.');
		}
		// Name-only searches have no domain scan to borrow the population total
		// from — start the unfiltered count in parallel with the name query.
		if (!domainNormalised) {
			countPromise = countCompanyTotal(context, itemIndex);
		}
		const nameCap = Math.min(Math.max(limit * 2, 25), MAX_CONTACT_FALLBACK_LIMIT);
		const nameResults = await runBoundedQuery(
			context,
			'company',
			itemIndex,
			nameCap,
			[{ field: 'companyName', op: 'contains', value: companyNameInput }],
			selectColumns,
		);
		nameScanned = nameResults.length;
		nameFilterComplete = nameResults.length < nameCap;
		for (const result of nameResults) {
			const id = result.id;
			if (!isValidCompanyId(id)) continue;
			const key = String(id);
			const existing = candidatesById.get(key);
			candidatesById.set(key, existing ? { ...existing, ...result } : result);
		}
	}

	// B1: the published candidates are this merged candidate set sliced at
	// `limit` (rankedResults below) — a DERIVED truncation invisible to the raw
	// queries' cap semantics. Report the pre-slice candidate count so the
	// completeness verdict and summary wording name this stage when it truncates.
	const derivedTruncation: DerivedTruncation | undefined =
		candidatesById.size > limit
			? {
					note: `the derived candidate set was limited to ${limit} of ${candidatesById.size} ranked candidates (limit ${limit}) — raise 'limit' or narrow the search`,
				}
			: undefined;
	const coverage = await buildSearchCoverage(
		domainScanned + nameScanned,
		totalAvailable !== undefined ? Promise.resolve(totalAvailable) : countPromise,
		// Codex P2: complete iff every contributing filtered query returned below
		// its cap (skipped stages count as complete — they contributed no window).
		// B1: AND the derived candidate set was not sliced at `limit` — any
		// truncation source keeps windowComplete false.
					domainFilterComplete && nameFilterComplete,
		derivedTruncation,
	);

	const nameNeedle = companyNameInput.toLowerCase();
	const rankedResults = Array.from(candidatesById.values())
		.map((candidate) =>
			scoreCompanyCandidate(candidate, nameNeedle, domainNormalised, websiteFields),
		)
		.sort((a, b) => {
			const scoreDiff = (b.confidence as number) - (a.confidence as number);
			if (scoreDiff !== 0) return scoreDiff;
			return String(a.companyName ?? '').localeCompare(String(b.companyName ?? ''), 'en-US');
		})
		.slice(0, limit);

	if (rankedResults.length === 0) {
		return {
			source: 'none',
			companyNameInput: companyNameInput || undefined,
			emailInput: emailInput || undefined,
			websiteInput: websiteInput || undefined,
			domainNormalised,
			count: 0,
			results: [],
			notes: ['No candidates found from identity signals.', ...notes],
			coverage,
		};
	}

	return {
		source: 'rankedIdentity',
		companyNameInput: companyNameInput || undefined,
		emailInput: emailInput || undefined,
		websiteInput: websiteInput || undefined,
		domainNormalised,
		count: rankedResults.length,
		results: rankedResults,
		...(notes.length > 0 ? { notes } : {}),
		coverage,
	};
}
