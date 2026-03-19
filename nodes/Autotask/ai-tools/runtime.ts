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
