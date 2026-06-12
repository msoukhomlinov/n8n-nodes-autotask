import type { RedisClientType } from 'redis';
import { hashCachePayload } from '../../cache/service';

export const REDIS_KEY_PREFIX = 'n8n-autotask';

export interface RedisConfig {
	host: string;
	port: number;
	password?: string;
	tls: boolean;
}

/**
 * Reads Redis connection settings from Autotask credentials. Returns null when disabled.
 * Param is Record<string, unknown> so call sites can pass `credentials as unknown as Record<string, unknown>`
 * and compile under strict mode (a typed interface param would reject `unknown`-valued fields).
 */
export function getRedisConfigFromCredentials(creds: Record<string, unknown>): RedisConfig | null {
	if (!creds || !creds['redisEnabled'] || !creds['redisHost']) {
		return null;
	}
	const port = creds['redisPort'];
	return {
		host: String(creds['redisHost']),
		port: typeof port === 'number' ? port : 6379,
		password: creds['redisPassword'] ? String(creds['redisPassword']) : undefined,
		tls: Boolean(creds['redisTls']),
	};
}

/**
 * 16-char hash of the THREAD-limit identity: {baseUrl, APIIntegrationcode}.
 * Username + Secret intentionally excluded.
 *
 * Rationale: Autotask scopes the 3-concurrent thread limit (Itgenatr005) by
 * (object endpoint + tracking identifier), where the tracking identifier IS the
 * API integration code — NOT the API username (confirmed by Autotask's
 * ThreadLimiting docs: the limit applies to "the combination of each unique API
 * tracking identifier plus object endpoint call"). Two API users that share one
 * integration code share ONE Autotask thread budget; they MUST therefore share one
 * Redis semaphore. Splitting the thread key by Username would give each user its own
 * 3-slot semaphore (6 effective slots for one budget) and re-introduce the exact
 * Itgenatr005 over-subscription this feature fixes. This also matches the in-memory
 * `endpointThreadTracker`, which keys on endpoint alone (no username dimension), so
 * the fail-open fallback stays equivalent.
 *
 * Object key is `APIIntegrationcode` (verbatim credential field name) so a Phase-2 cache
 * migration that hashes the same identity produces matching keys.
 */
export function redisKeyHash(baseUrl: string, integrationCode: string): string {
	return hashCachePayload({ baseUrl, APIIntegrationcode: integrationCode }).slice(0, 16);
}

/**
 * 16-char hash of the POLL/USAGE identity: {baseUrl, APIIntegrationcode, Username}.
 * Username IS included here (and Secret still excluded — survives rotation).
 *
 * Rationale: the `poll` dedup lock and `usage` snapshot key carry the database-wide
 * `ThresholdInformation` triple. Two distinct API users (different `Username`) on the
 * same zone + integration code may point at DIFFERENT Autotask databases — a zone URL
 * hosts many tenant databases, so baseUrl + integration code alone does not identify a
 * database. Sharing the poll/usage key across them would serve one credential's usage
 * snapshot for the other and suppress the other's own poll for the lock window
 * (the cross-credential bleed Codex flagged). Adding Username scopes these keys per
 * API user; when two users genuinely share one database the underlying number is
 * identical, so this never harms correctness — it only prevents the bleed.
 *
 * NOTE: this hash is for poll/usage ONLY. The thread semaphore deliberately uses
 * `redisKeyHash` (no Username) — see its rationale above. Do NOT swap them.
 */
export function redisUsageKeyHash(baseUrl: string, integrationCode: string, username: string): string {
	return hashCachePayload({ baseUrl, APIIntegrationcode: integrationCode, Username: username }).slice(0, 16);
}

/** Replaces a known password substring with *** so it never reaches logs. */
export function scrubRedisSecret(message: string, password?: string): string {
	if (!password || password.length < 3) return message;
	return message.split(password).join('***');
}

// Minimal surface we use, so callers don't depend on the full node-redis type.
export interface RedisLike {
	set(key: string, value: string, opts?: { NX?: boolean; PX?: number }): Promise<string | null>;
	get(key: string): Promise<string | null>;
	// eval() here is the Redis server-side Lua script evaluation API (EVAL command),
	// not JavaScript eval(). Scripts execute inside the Redis process; no JS code is run.
	eval(
		script: string,
		opts: { keys: string[]; arguments: string[] },
	): Promise<unknown>;
	zRem(key: string, member: string): Promise<number>;
	destroy?(): void;
}

interface Entry {
	client: RedisLike | null;
	healthy: boolean;
	connecting: Promise<RedisLike | null> | null;
	lastFailedAt: number;
}

const registry = new Map<string, Entry>();
const RETRY_AFTER_FAIL_MS = 30_000;

// Opaque per-password token for the registry key. The password is NOT hashed
// (a fast hash of a credential trips js/insufficient-password-hash) and never
// leaves the process — this token only distinguishes registry entries so two
// credentials sharing host:port:tls but using different Redis passwords never
// share a client. The password is already held in memory on RedisConfig; this
// adds no new exposure and is never logged, persisted, or transmitted.
const pwTokens = new Map<string, string>();
function passwordToken(password?: string): string {
	if (!password) return 'nopw';
	let token = pwTokens.get(password);
	if (!token) {
		token = `pw${pwTokens.size}`;
		pwTokens.set(password, token);
	}
	return token;
}

function connectionKey(cfg: RedisConfig): string {
	return `${cfg.host}:${cfg.port}:${cfg.tls ? 1 : 0}:${passwordToken(cfg.password)}`;
}

/**
 * Returns a connected Redis client for the given config, or null if Redis is
 * unavailable/unhealthy (caller must fail open). Lazy-requires `redis` so a
 * missing module degrades to null rather than erroring the node at load.
 */
export async function getRedisClient(cfg: RedisConfig): Promise<RedisLike | null> {
	const key = connectionKey(cfg);
	const existing = registry.get(key);
	if (existing) {
		if (existing.healthy && existing.client) return existing.client;
		if (existing.connecting) return existing.connecting;
		if (Date.now() - existing.lastFailedAt < RETRY_AFTER_FAIL_MS) return null;
	}

	const entry: Entry = existing ?? { client: null, healthy: false, connecting: null, lastFailedAt: 0 };
	registry.set(key, entry);

	entry.connecting = (async () => {
		try {
			// Lazy require — keeps the node load-safe if `redis` is missing.
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { createClient } = require('redis') as typeof import('redis');
			// reconnectStrategy:false — first connection failure is final and connect() rejects.
			// Without this, node-redis retries indefinitely and connect() never settles,
			// causing every caller to hang until n8n's execution timeout (fail-open defeated).
			// connectTimeout:3000 — bound the OS-default SYN timeout so a silently-dropped
			// packet doesn't stall the promise for tens of seconds.
			const socketOpts = cfg.tls
				? { host: cfg.host, port: cfg.port, tls: true as const, reconnectStrategy: false as const, connectTimeout: 3000 }
				: { host: cfg.host, port: cfg.port, reconnectStrategy: false as const, connectTimeout: 3000 };
			const client = createClient({
				socket: socketOpts,
				password: cfg.password,
			}) as RedisClientType;

			client.on('error', (err: unknown) => {
				entry.healthy = false;
				entry.lastFailedAt = Date.now();
				try { (entry.client as RedisLike | null)?.destroy?.(); } catch { /* ignore */ }
				entry.client = null;
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[redis] client error: ${scrubRedisSecret(msg, cfg.password)}`);
			});

			await client.connect();
			entry.client = client as unknown as RedisLike;
			entry.healthy = true;
			return entry.client;
		} catch (err) {
			entry.healthy = false;
			entry.lastFailedAt = Date.now();
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[redis] connect failed: ${scrubRedisSecret(msg, cfg.password)}`);
			return null;
		} finally {
			entry.connecting = null;
		}
	})();

	return entry.connecting;
}

/** Test-only: reset the client registry. */
export function __resetRedisRegistry(): void {
	for (const entry of registry.values()) {
		try { entry.client?.destroy?.(); } catch { /* ignore */ }
	}
	registry.clear();
	pwTokens.clear();
}
