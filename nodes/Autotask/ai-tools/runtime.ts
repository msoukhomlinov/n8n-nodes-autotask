import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { z as ZodNamespace } from 'zod';

type DynamicStructuredToolCtor = new (fields: {
    name: string; description: string; schema: any;
    func: (params: Record<string, unknown>) => Promise<string>;
}) => DynamicStructuredTool;

export type RuntimeZod = typeof ZodNamespace;

const ANCHOR_CANDIDATES = [
    '@langchain/classic/agents',
    'langchain/agents',
] as const;

function getRuntimeRequire(): NodeRequire {
    const { createRequire } = require('module') as { createRequire: (f: string) => NodeRequire };
    const errors: string[] = [];

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
        `Tried ${ANCHOR_CANDIDATES.length} candidates:\n${errors.join('\n')}\n` +
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

function ensureRuntime(): void {
    if (!_runtimeRequire) {
        _runtimeRequire = getRuntimeRequire();
        const coreTools = _runtimeRequire('@langchain/core/tools') as Record<string, any>;
        _RuntimeDST = coreTools['DynamicStructuredTool'] as DynamicStructuredToolCtor;
        _runtimeZod = _runtimeRequire('zod') as RuntimeZod;
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
