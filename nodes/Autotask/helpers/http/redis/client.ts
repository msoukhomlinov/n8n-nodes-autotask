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
 * 16-char hash of {baseUrl, APIIntegrationcode}. Username + Secret intentionally excluded.
 * Object key is `APIIntegrationcode` (verbatim credential field name) so a Phase-2 cache
 * migration that hashes the same identity produces matching keys.
 */
export function redisKeyHash(baseUrl: string, integrationCode: string): string {
	return hashCachePayload({ baseUrl, APIIntegrationcode: integrationCode }).slice(0, 16);
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

function connectionKey(cfg: RedisConfig): string {
	const pwTag = cfg.password ? hashCachePayload({ pw: cfg.password }).slice(0, 8) : 'nopw';
	return `${cfg.host}:${cfg.port}:${cfg.tls ? 1 : 0}:${pwTag}`;
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
}
