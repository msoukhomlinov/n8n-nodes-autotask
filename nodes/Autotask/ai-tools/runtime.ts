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

function getRuntimeRequire(): NodeRequire {
    const { createRequire } = require('module') as { createRequire: (f: string) => NodeRequire };
    const errors: string[] = [];

    // Strategy 1: Resolve from n8n's main module to avoid local devDep shadowing.
    // During development, the project's node_modules may contain @langchain/core
    // as a devDependency. If require.resolve finds that copy instead of n8n's,
    // instanceof checks fail because two separate module instances coexist.
    // Resolving from require.main finds n8n's copy first.
    const mainFile = require.main?.filename;
    if (mainFile) {
        const mainRequire = createRequire(mainFile);
        for (const candidate of ANCHOR_CANDIDATES) {
            try {
                const anchorPath = mainRequire.resolve(candidate);
                return createRequire(anchorPath);
            } catch (err) {
                errors.push(`  main:${candidate}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // Strategy 2: Standard resolution from this module (current behavior).
    // Needed when @langchain/classic is not resolvable from the main module's
    // location (e.g. some deployment configurations), or when require.main is
    // unavailable.
    for (const candidate of ANCHOR_CANDIDATES) {
        try {
            const anchorPath = require.resolve(candidate);
            return createRequire(anchorPath);
        } catch (err) {
            errors.push(`  ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    throw new Error(
        `runtime.ts: Failed to resolve any LangChain anchor module. ` +
        `Tried ${ANCHOR_CANDIDATES.length} candidates across 2 strategies:\n${errors.join('\n')}\n` +
        `This means DynamicStructuredTool instanceof checks will fail. ` +
        `Ensure @langchain/classic is installed.`,
    );
}

// ---------------------------------------------------------------------------
// Lazy initialisation — deferred until first call so that importing this
// module at n8n startup does NOT throw when LangChain is unavailable.
// This prevents the entire node *package* (including the standard Autotask
// and AutotaskTrigger nodes) from being marked as errored.
// ---------------------------------------------------------------------------

let _runtimeRequire: NodeRequire | null = null;
let _RuntimeDST: DynamicStructuredToolCtor | null = null;
let _runtimeZod: RuntimeZod | null = null;
let _logWrapper: LogWrapperFn | null = null;
let _logWrapperAttempted = false;

function ensureRuntime(): void {
    if (!_runtimeRequire) {
        _runtimeRequire = getRuntimeRequire();
        const coreTools = _runtimeRequire('@langchain/core/tools') as Record<string, any>;
        _RuntimeDST = coreTools['DynamicStructuredTool'] as DynamicStructuredToolCtor;

        // Resolve zod from n8n's TOP-LEVEL node_modules, not from @langchain/classic's
        // nested copy. n8n-nodes-langchain's normalizeToolSchema does
        // `tool.schema instanceof ZodType` using n8n's top-level zod. If we build schemas
        // with @langchain/classic/node_modules/zod (a different module instance), that
        // instanceof check fails and normalizeToolSchema corrupts the schema by treating
        // the Zod object as JSON Schema.
        const { createRequire: cr } = require('module') as { createRequire: (f: string) => NodeRequire };
        const mainFile = require.main?.filename;
        if (mainFile) {
            try {
                _runtimeZod = cr(mainFile)('zod') as RuntimeZod;
            } catch {
                _runtimeZod = _runtimeRequire('zod') as RuntimeZod;
            }
        } else {
            _runtimeZod = _runtimeRequire('zod') as RuntimeZod;
        }
    }
}

export function getLazyRuntimeDST(): DynamicStructuredToolCtor {
    ensureRuntime();
    return _RuntimeDST!;
}

export function getLazyRuntimeZod(): RuntimeZod {
    ensureRuntime();
    return _runtimeZod!;
}

export function getLazyLogWrapper(): LogWrapperFn | null {
    if (_logWrapperAttempted) return _logWrapper;
    _logWrapperAttempted = true;
    // _runtimeRequire must be available (ensureRuntime called first)
    if (!_runtimeRequire) return null;
    try {
        const aiUtils = _runtimeRequire('@n8n/ai-utilities') as Record<string, unknown>;
        const fn = aiUtils['logWrapper'];
        if (typeof fn === 'function') {
            _logWrapper = fn as LogWrapperFn;
        }
    } catch {
        // @n8n/ai-utilities not available — tool works without logging
    }
    return _logWrapper;
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
            const z = getLazyRuntimeZod();
            return Reflect.get(z, prop, receiver);
        },
    },
) as RuntimeZod;
