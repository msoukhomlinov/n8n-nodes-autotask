import type { IncomingHttpHeaders } from 'node:http';
import type { ISupplyDataFunctions } from 'n8n-workflow';
import { normaliseZone, type OverrideAutotaskCredentials } from './credential-store';

// Zone URL must be HTTPS and match known Autotask domain patterns.
const ZONE_ALLOWLIST = /^https:\/\/webservices\d+\.autotask\.(net|com|com\.au|co\.uk)\/atservicesrest$/i;

// Reject control characters (0x00-0x1F, 0x7F DEL); max 1024 chars. Unicode allowed.
// Permits non-ASCII names (e.g. josé@example.com) and Unicode passwords while still
// blocking header-injection vectors (CR/LF/NUL).
// eslint-disable-next-line no-control-regex
const SAFE_HEADER_VALUE = /^[^\x00-\x1F\x7F]{1,1024}$/;

const HEADER_NAMES = [
    'x-autotask-username',
    'x-autotask-secret',
    'x-autotask-integrationcode',
    'x-autotask-zone',
] as const;

export type HeaderParseResult =
    | { type: 'none' }
    | { type: 'ok'; creds: Readonly<OverrideAutotaskCredentials> }
    | { type: 'error'; message: string };

/**
 * Normalise raw Node HTTP IncomingHttpHeaders into a lowercase `Record<string,string>`.
 * - Lowercases all keys (HTTP headers are case-insensitive).
 * - Collapses array values (e.g. duplicate Set-Cookie style) by taking the first entry.
 * - Skips undefined values.
 */
export function normaliseIncomingHeaders(raw: IncomingHttpHeaders): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v === undefined) continue;
        out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
    return out;
}

export function parseAndValidateHeaders(headers: Record<string, string | undefined>): HeaderParseResult {
    const values = HEADER_NAMES.map(h => headers[h]);
    const presentCount = values.filter(Boolean).length;

    if (presentCount === 0) return { type: 'none' };
    if (presentCount < HEADER_NAMES.length) {
        const missing = HEADER_NAMES.filter(h => !headers[h]).join(', ');
        return { type: 'error', message: `Missing required X-Autotask-* headers: ${missing}` };
    }

    const [username, secret, integrationCode, zoneRaw] = values as [string, string, string, string];

    for (const [header, value] of [
        ['x-autotask-username', username],
        ['x-autotask-secret', secret],
        ['x-autotask-integrationcode', integrationCode],
        ['x-autotask-zone', zoneRaw],
    ] as const) {
        if (!SAFE_HEADER_VALUE.test(value)) {
            return { type: 'error', message: `Invalid characters or length in ${header}` };
        }
    }

    const zone = normaliseZone(zoneRaw);
    if (!ZONE_ALLOWLIST.test(zone)) {
        return { type: 'error', message: `Invalid X-Autotask-Zone value: must be https://webservicesN.autotask.(net|com|com.au|co.uk)/atservicesrest` };
    }

    return {
        type: 'ok',
        creds: Object.freeze({ Username: username, Secret: secret, APIIntegrationcode: integrationCode, zone }),
    };
}

/**
 * Wraps a context so `getCredentials('autotaskApi', ...)` always resolves to a
 * pre-fetched value instead of calling the live context's `getCredentials`.
 *
 * Why: n8n's MCP Server Trigger invokes the AI tool's `func()` closure directly
 * (LangChain's tool executor), outside n8n's normal per-node execution
 * machinery. Under n8n's `vm` expression-engine (default since n8n 2.35),
 * calling `context.getCredentials(...)` from that deferred call site throws
 * "No bridge acquired for this context" — the isolate window n8n opens around
 * a workflow execution has already closed by the time the LLM invokes the
 * tool (see issue #138). `supplyData()` itself runs inside a valid window, so
 * resolving credentials once there and closing over the value sidesteps the
 * live-context call entirely — a root-cause fix that behaves identically
 * whether the host n8n instance uses the `legacy` or `vm` expression engine.
 */
export function buildCachedCredentialProxy<T extends ISupplyDataFunctions>(
    context: T,
    resolvedCredentials: unknown,
): T {
    return new Proxy(context, {
        get(target, prop, _receiver) {
            if (prop === 'getCredentials') {
                return (...args: Parameters<typeof target.getCredentials>) => {
                    if (args[0] !== 'autotaskApi') return target.getCredentials(...args);
                    return Promise.resolve(resolvedCredentials);
                };
            }
            // Bind to target (not proxy) to preserve this-binding for class methods with private fields.
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as T;
}

export function buildCredentialProxy(
    context: ISupplyDataFunctions,
    override: Readonly<OverrideAutotaskCredentials>,
): ISupplyDataFunctions {
    return new Proxy(context, {
        get(target, prop, _receiver) {
            if (prop === 'getCredentials') {
                // Override only 'autotaskApi'; delegate all other credential names to the original context.
                // For 'autotaskApi': merge override auth fields into the original credentials so that
                // non-auth settings (cacheEnabled, cacheTTL, etc.) continue to work under injection.
                return (...args: Parameters<typeof target.getCredentials>) => {
                    if (args[0] !== 'autotaskApi') return target.getCredentials(...args);
                    return target.getCredentials('autotaskApi', args[1]).then(
                        (originalCreds) => Object.freeze({
                            ...originalCreds,
                            Username: override.Username,
                            Secret: override.Secret,
                            APIIntegrationcode: override.APIIntegrationcode,
                            zone: override.zone,
                        }),
                    );
                };
            }
            // Bind to target (not proxy) to preserve this-binding for class methods with private fields.
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
