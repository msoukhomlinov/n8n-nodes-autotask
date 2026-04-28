import type { IExecuteFunctions } from 'n8n-workflow';
import { CountOperation } from '../operations/base/count-operation';
import type { IAutotaskEntity } from '../types';

export const DEFAULT_QUERY_LIMIT = 10;
export const MAX_QUERY_LIMIT = 500;

export function getEffectiveLimit(limit: number | undefined): number {
	if (typeof limit !== 'number' || Number.isNaN(limit)) {
		return DEFAULT_QUERY_LIMIT;
	}
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_QUERY_LIMIT);
}

// Used for count-injection. Must NOT route through executeToolOperation — the two would
// share (and race on) the same context.getNodeParameter override.
export async function executeCountOperation(
	resource: string,
	filters: unknown[],
	context: IExecuteFunctions,
): Promise<number | null> {
	try {
		const scopedContext = Object.create(context) as IExecuteFunctions;
		scopedContext.getNodeParameter = ((
			name: string,
			_index: number,
			fallback?: unknown,
		): unknown => {
			if (name === 'filtersFromTool') return filters;
			if (name === 'returnAll') return false;
			if (name === 'id') return null;
			return context.getNodeParameter(name, 0, fallback);
		}) as IExecuteFunctions['getNodeParameter'];
		const countOp = new CountOperation<IAutotaskEntity>(resource, scopedContext);
		return await countOp.execute(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.debug('[executeCountOperation] count call failed:', message);
		return null;
	}
}
