import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { z as ZodNamespace } from 'zod';
import type { ISupplyDataFunctions } from 'n8n-workflow';

type DynamicStructuredToolCtor = new (fields: {
    name: string; description: string; schema: any;
    func: (params: Record<string, unknown>) => Promise<string>;
}) => DynamicStructuredTool;

export type RuntimeZod = typeof ZodNamespace;

type LogWrapperFn = <T>(tool: T, executeFunctions: ISupplyDataFunctions) => T;

const ANCHOR_CANDIDATES = [
    '@langchain/classic/agents',
    'langchain/agents',
] as const;

// Two-strategy host-anchor resolution: n8n's own module tree provides the exact
// DynamicStructuredTool/zod instances its Agent/MCP Trigger code checks `instanceof`
// against. Strategy 1 anchors on require.main (n8n's entry point) to avoid local
// devDependency copies shadowing n8n's own during development (npm link). Strategy 2
// falls back to standard resolution from this module when require.main is unavailable
// or its anchor probe fails.
//
// Under pnpm's strict dependency isolation (n8n >=2.29.x), community nodes installed
// outside n8n's own workspace (e.g. ~/.n8n/nodes/) have NO node_modules edge into
// @n8n/n8n-nodes-langchain's isolated LangChain bundle — neither strategy can ever
// resolve @langchain/classic/agents or langchain/agents in that topology, regardless
// of which file anchors the probe. Returns null (never throws) so callers can fall
// back to a require.cache scan — see findCachedExports() below.
// See: https://github.com/msoukhomlinov/n8n-nodes-autotask/issues/108
function getRuntimeRequire(): NodeRequire | null {
    const { createRequire } = require('module') as { createRequire: (f: string) => NodeRequire };

    const mainFile = require.main?.filename;
    if (mainFile) {
        const mainRequire = createRequire(mainFile);
        for (const candidate of ANCHOR_CANDIDATES) {
            try {
                return createRequire(mainRequire.resolve(candidate));
            } catch {
                // try next candidate / strategy
            }
        }
    }

    for (const candidate of ANCHOR_CANDIDATES) {
        try {
            return createRequire(require.resolve(candidate));
        } catch {
            // try next candidate
        }
    }

    return null;
}

// Scans Node's process-global require.cache — a single object shared across every
// node_modules tree in this process, keyed by absolute resolved file path, regardless
// of which package loaded a given module — for an already-loaded module whose path
// matches pathPattern, returning the first match whose exports satisfy validate.
//
// This is the pnpm-isolation fallback: n8n's own Agent/MCP Trigger machinery always
// loads @langchain/core/tools (and @n8n/ai-utilities, and zod) before ever calling
// supplyData() on a connected sub-node, so by execution time those modules are
// guaranteed to be resident in the cache regardless of install layout — and scanning
// for them there returns the EXACT SAME class/namespace instance n8n itself uses,
// preserving instanceof compatibility that a locally-bundled copy could not.
//
// Must be called lazily (not at module load) — n8n registers node files for discovery
// before any workflow runs, i.e. before LangChain is loaded into the cache.
function findCachedExports<T>(
    pathPattern: RegExp,
    validate: (exports: Record<string, unknown>) => T | undefined,
): T | undefined {
    try {
        const cache = require.cache;
        if (!cache) return undefined;
        for (const key of Object.keys(cache)) {
            if (!pathPattern.test(key)) continue;
            const entry = cache[key];
            if (!entry) continue;
            const result = validate(entry.exports as Record<string, unknown>);
            if (result !== undefined) return result;
        }
    } catch {
        // best-effort — require.cache introspection is not guaranteed across Node versions
    }
    return undefined;
}

// undefined = anchor probing not yet attempted; null = attempted and failed (module
// resolution is deterministic for a given install layout, so a negative result is safe
// to cache permanently — unlike the resolvers below, which retry via cache-scan until
// they succeed once, since cache population is a temporal event during n8n startup).
let _runtimeRequire: NodeRequire | null | undefined;
let _RuntimeDST: DynamicStructuredToolCtor | undefined;
let _runtimeZod: RuntimeZod | undefined;
let _logWrapper: LogWrapperFn | undefined;

function getResolvedRuntimeRequire(): NodeRequire | null {
    if (_runtimeRequire === undefined) {
        _runtimeRequire = getRuntimeRequire();
    }
    return _runtimeRequire;
}

function resolveRuntimeDST(): DynamicStructuredToolCtor | undefined {
    if (_RuntimeDST) return _RuntimeDST;

    const runtimeRequire = getResolvedRuntimeRequire();
    if (runtimeRequire) {
        try {
            const coreTools = runtimeRequire('@langchain/core/tools') as Record<string, any>;
            if (typeof coreTools?.DynamicStructuredTool === 'function') {
                _RuntimeDST = coreTools.DynamicStructuredTool as DynamicStructuredToolCtor;
                return _RuntimeDST;
            }
        } catch {
            // fall through to cache scan
        }
    }

    const cached = findCachedExports(/[\\/]@langchain[\\/]core[\\/]/, (exports) =>
        typeof exports.DynamicStructuredTool === 'function'
            ? (exports.DynamicStructuredTool as DynamicStructuredToolCtor)
            : undefined,
    );
    if (cached) {
        _RuntimeDST = cached;
    }
    return _RuntimeDST;
}

function resolveRuntimeZod(): RuntimeZod | undefined {
    if (_runtimeZod) return _runtimeZod;

    // Primary path: n8n's top-level zod (the copy n8n-nodes-langchain's
    // normalizeToolSchema uses for `instanceof ZodType`), resolved via require.main so
    // local devDependency copies never shadow it during development.
    const { createRequire: cr } = require('module') as { createRequire: (f: string) => NodeRequire };
    const mainFile = require.main?.filename;
    if (mainFile) {
        try {
            _runtimeZod = cr(mainFile)('zod') as RuntimeZod;
            if (_runtimeZod) return _runtimeZod;
        } catch {
            // fall through
        }
    }

    const runtimeRequire = getResolvedRuntimeRequire();
    if (runtimeRequire) {
        try {
            _runtimeZod = runtimeRequire('zod') as RuntimeZod;
            if (_runtimeZod) return _runtimeZod;
        } catch {
            // fall through to cache scan
        }
    }

    // Same pnpm-isolation fallback as resolveRuntimeDST(): scan require.cache for zod's
    // namespace once it's resident. Validate the exports look like zod (ZodType and
    // object are functions — normalizeToolSchema does `instanceof ZodType`) rather than
    // trusting the path match alone — the regex is narrowed to zod's own entry files so
    // it never matches zod-to-json-schema or other zod-adjacent packages. Only reached
    // when require.main('zod') AND the anchor-require both fail first, which in practice
    // is rare: n8n core itself depends on zod, so require.main('zod') above already
    // recovers n8n's top-level copy on most pnpm-isolated installs. If this scan path
    // ever IS reached with multiple shape-valid zod copies resident, it returns the
    // first cache match rather than a guaranteed-correct one — a real but low-probability
    // residual risk, not an instance guarantee.
    const cached = findCachedExports(/[\\/]zod[\\/](lib|dist|index|v3|v4)/, (exports) =>
        typeof exports.ZodType === 'function' && typeof exports.object === 'function'
            ? (exports as unknown as RuntimeZod)
            : undefined,
    );
    if (cached) {
        _runtimeZod = cached;
    }
    return _runtimeZod;
}

export function getLazyRuntimeDST(): DynamicStructuredToolCtor {
    const ctor = resolveRuntimeDST();
    if (!ctor) {
        throw new Error(
            `runtime.ts: Failed to resolve DynamicStructuredTool from either n8n's module ` +
            `tree (host-anchor probing) or Node's require.cache (pnpm-isolated fallback). ` +
            `This means DynamicStructuredTool instanceof checks will fail. ` +
            `Ensure @langchain/core is loaded somewhere in this n8n process.`,
        );
    }
    return ctor;
}

export function getLazyRuntimeZod(): RuntimeZod {
    const zod = resolveRuntimeZod();
    if (!zod) {
        throw new Error(
            `runtime.ts: Failed to resolve zod from either n8n's module tree (require.main) ` +
            `or Node's require.cache (pnpm-isolated fallback). ` +
            `Ensure zod is loaded somewhere in this n8n process.`,
        );
    }
    return zod;
}

export function getLazyLogWrapper(): LogWrapperFn | null {
    if (_logWrapper) return _logWrapper;

    const runtimeRequire = getResolvedRuntimeRequire();
    if (runtimeRequire) {
        try {
            const aiUtils = runtimeRequire('@n8n/ai-utilities') as Record<string, unknown>;
            const fn = (aiUtils as any)?.logWrapper ?? (aiUtils as any)?.default?.logWrapper;
            if (typeof fn === 'function') {
                _logWrapper = fn as LogWrapperFn;
                return _logWrapper;
            }
        } catch {
            // fall through to cache scan
        }
    }

    const cached = findCachedExports(/[\\/]@n8n[\\/]ai-utilities[\\/]/, (exports) => {
        const fn = (exports as any).logWrapper ?? (exports as any).default?.logWrapper;
        return typeof fn === 'function' ? (fn as LogWrapperFn) : undefined;
    });
    if (cached) {
        _logWrapper = cached;
    }
    return _logWrapper ?? null;
}

// ---------------------------------------------------------------------------
// Proxy-based top-level exports — provide [[Construct]] / property access
// without eagerly resolving the runtime.  If resolution fails at module load,
// the node still *registers* in n8n; the error surfaces only when the Proxy
// traps fire (i.e. inside supplyData()).
//
// CRITICAL: RuntimeDynamicStructuredTool's Proxy target MUST be a function,
// not a plain object.  Per ECMAScript §10.5.13 a Proxy only has a
// [[Construct]] internal method when its target does.  Plain objects lack
// [[Construct]], so `new Proxy({}, { construct… })` throws
// "TypeError: … is not a constructor" before the construct trap ever fires.
// Using `function () {}` as the target provides [[Construct]] so the trap
// delegates correctly to n8n's resolved DynamicStructuredTool class.
// ---------------------------------------------------------------------------

export const RuntimeDynamicStructuredTool: DynamicStructuredToolCtor = new Proxy(
    function () {} as unknown as DynamicStructuredToolCtor,
    {
        construct(_target, args) {
            const Ctor = getLazyRuntimeDST();
            return new (Ctor as any)(...args) as object;
        },
        get(_target, prop, receiver) {
            const Ctor = getLazyRuntimeDST();
            return Reflect.get(Ctor, prop, receiver);
        },
    },
) as DynamicStructuredToolCtor;

export const runtimeZod: RuntimeZod = new Proxy(
    {} as RuntimeZod,
    {
        get(_target, prop, receiver) {
            // Guard: frameworks probe Symbol.toPrimitive, Symbol.toStringTag, .then
            // (Promise thenable duck-typing), and .constructor. Throwing on these
            // causes misleading errors during structural inspection rather than the
            // intended zod-unavailable diagnostic.
            if (typeof prop === 'symbol' || prop === 'then' || prop === 'constructor') return undefined;
            const z = getLazyRuntimeZod();
            return Reflect.get(z, prop, receiver);
        },
    },
) as RuntimeZod;
