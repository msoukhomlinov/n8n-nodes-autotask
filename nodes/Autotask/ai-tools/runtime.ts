// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const runtimeRequire = getRuntimeRequire();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const coreTools = runtimeRequire('@langchain/core/tools') as Record<string, any>;
export const RuntimeDynamicStructuredTool = coreTools['DynamicStructuredTool'] as DynamicStructuredToolCtor;
export const runtimeZod = runtimeRequire('zod') as RuntimeZod;
