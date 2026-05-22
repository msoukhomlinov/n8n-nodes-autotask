// nodes/Autotask/helpers/credential-store.ts
import { AsyncLocalStorage } from 'async_hooks';
import { hashCachePayload } from './cache/service';

export interface OverrideAutotaskCredentials {
    readonly Username: string;
    readonly Secret: string;
    readonly APIIntegrationcode: string;
    readonly zone: string; // always normalised: trailing slash stripped
}

// --- ALS: credentials ---
// globalThis symbol guarantees singleton across require.cache invalidation and npm-link symlinks.
const STORE_KEY = Symbol.for('n8n-nodes-autotask.credentialStore.v1');
export const autotaskCredentialStore: AsyncLocalStorage<Readonly<OverrideAutotaskCredentials>> =
    (globalThis as Record<symbol, unknown>)[STORE_KEY] as AsyncLocalStorage<Readonly<OverrideAutotaskCredentials>> ??
    (() => {
        const store = new AsyncLocalStorage<Readonly<OverrideAutotaskCredentials>>();
        (globalThis as Record<symbol, unknown>)[STORE_KEY] = store;
        return store;
    })();

// --- ALS: request headers ---
// Separate ALS for the current HTTP request's headers. Necessary because
// concurrent MCP requests share the same McpServer instance — a shared instance
// property would race. Each `tools/call` runs inside its own ALS context.
const HEADERS_STORE_KEY = Symbol.for('n8n-nodes-autotask.requestHeaderStore.v1');
export const requestHeaderStore: AsyncLocalStorage<Record<string, string>> =
    (globalThis as Record<symbol, unknown>)[HEADERS_STORE_KEY] as AsyncLocalStorage<Record<string, string>> ??
    (() => {
        const store = new AsyncLocalStorage<Record<string, string>>();
        (globalThis as Record<symbol, unknown>)[HEADERS_STORE_KEY] = store;
        return store;
    })();

export function normaliseZone(url: string): string {
    return url.replace(/\/+$/, '');
}

// Includes Secret so two users sharing a username but with different passwords get distinct keys.
export function probeCredentialIdentity(creds: Readonly<OverrideAutotaskCredentials>): string {
    return hashCachePayload({
        username: creds.Username,
        integrationCode: creds.APIIntegrationcode,
        secret: creds.Secret,
        zone: normaliseZone(creds.zone),
    }).slice(0, 16);
}

// --- Probe cache ---

const PROBE_POSITIVE_TTL_MS = 60_000;
const PROBE_NEGATIVE_TTL_MS = 5_000;
const PROBE_MAX_ENTRIES = 256;

interface ProbeCacheEntry { ok: boolean; expiresAt: number }
const probeCache = new Map<string, ProbeCacheEntry>();
const probeInFlight = new Map<string, Promise<boolean>>();

export function getProbeCache(identity: string): boolean | undefined {
    const entry = probeCache.get(identity);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { probeCache.delete(identity); return undefined; }
    return entry.ok;
}

export function setProbeCache(identity: string, ok: boolean): void {
    if (probeCache.size >= PROBE_MAX_ENTRIES) {
        // FIFO eviction: remove oldest-inserted entry when cap is reached.
        const oldest = probeCache.keys().next().value;
        if (oldest !== undefined) probeCache.delete(oldest);
    }
    probeCache.set(identity, { ok, expiresAt: Date.now() + (ok ? PROBE_POSITIVE_TTL_MS : PROBE_NEGATIVE_TTL_MS) });
}

/**
 * Invalidate a positive probe cache entry and immediately insert a negative entry.
 * Use ONLY for execution-time 401/403 events — when a previously-positive
 * credential is rejected by Autotask during a real tool call.
 * Do NOT call for fresh probe failures — probeCredentials() handles those.
 */
export function invalidateProbeCache(identity: string): void {
    probeCache.delete(identity);
    setProbeCache(identity, false);
}

/**
 * Probes Autotask credentials. In-flight coalesces concurrent calls for the same identity.
 * - true  = valid (2xx), cached positively for 60s
 * - false = rejected (401/403), cached negatively for 5s
 * - true  = network error — NOT cached, so next call retries
 */
export async function probeCredentials(
    creds: Readonly<OverrideAutotaskCredentials>,
    httpRequest: (opts: { method: string; url: string; headers: Record<string, string> }) => Promise<unknown>,
): Promise<boolean> {
    const identity = probeCredentialIdentity(creds);
    const cached = getProbeCache(identity);
    if (cached !== undefined) return cached;

    const inFlight = probeInFlight.get(identity);
    if (inFlight) return inFlight;

    const promise = (async () => {
        try {
            await httpRequest({
                method: 'GET',
                url: `${normaliseZone(creds.zone)}/V1.0/Companies/entityInformation`,
                headers: {
                    ApiIntegrationcode: creds.APIIntegrationcode,
                    UserName: creds.Username,
                    Secret: creds.Secret,
                },
            });
            setProbeCache(identity, true);
            return true;
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
                ?? (err as { statusCode?: number })?.statusCode
                ?? 0;
            if (status === 401 || status === 403) {
                setProbeCache(identity, false);
                return false;
            }
            // Network errors: do NOT cache — transient outage must not lock users out.
            return true;
        } finally {
            probeInFlight.delete(identity);
        }
    })();

    probeInFlight.set(identity, promise);
    return promise;
}
