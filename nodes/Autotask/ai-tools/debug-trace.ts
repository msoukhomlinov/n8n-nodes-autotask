import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FieldMeta } from '../helpers/aiHelper';

/** Matches Autotask API credential default `cacheDirectory` (`./cache/autotask`). */
const DEFAULT_DEBUG_LOG_DIR = resolve(process.cwd(), 'cache', 'autotask');

const DEBUG_LOG_FILENAME = 'autotask-ai-tool-debug.jsonl';

/** Set when file cache initialises — same folder as `cache.json` for that credential. */
let aiToolDebugLogDir: string | undefined;
let didWarnDebugPathFailure = false;

export function setAiToolDebugLogDir(dir: string): void {
	aiToolDebugLogDir = dir;
}

export function clearAiToolDebugLogDir(): void {
	aiToolDebugLogDir = undefined;
}

export function getAiToolDebugFilePath(): string {
	return join(aiToolDebugLogDir ?? DEFAULT_DEBUG_LOG_DIR, DEBUG_LOG_FILENAME);
}

// Code toggle only (not environment-driven).
export const AI_TOOL_DEBUG_ENABLED = true;
export const AI_TOOL_DEBUG_VERBOSE = true;

export interface AiTraceEvent {
	ts: string;
	area:
		| 'tool-build'
		| 'schema-build'
		| 'description-build'
		| 'tool-call'
		| 'filter-build'
		| 'label-resolution'
		| 'write-guard'
		| 'executor'
		| 'response'
		| 'error';
	phase?: string;
	resource?: string;
	operation?: string;
	correlationId?: string;
	itemIndex?: number;
	durationMs?: number;
	summary: Record<string, unknown>;
}

export function writeAiTrace(event: Omit<AiTraceEvent, 'ts'>): void {
	if (!AI_TOOL_DEBUG_ENABLED) return;
	try {
		const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`;
		const filePath = getAiToolDebugFilePath();
		mkdir(dirname(filePath), { recursive: true })
			.then(() => appendFile(filePath, line, 'utf8'))
			.catch((error: unknown) => {
				if (didWarnDebugPathFailure) return;
				didWarnDebugPathFailure = true;
				const message = error instanceof Error ? error.message : String(error);
				console.warn(
					`[AutotaskAiTools] Failed writing AI debug trace at "${filePath}": ${message}`,
				);
				// best-effort only: trace failures must never affect node execution
			});
	} catch {
		// best-effort only: JSON.stringify failures must never affect node execution
	}
}

export function safeKeys(value: unknown): string[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.keys(value as Record<string, unknown>).sort();
}

export function safeSchemaKeys(schema: unknown): string[] {
	if (!schema || typeof schema !== 'object') return [];

	const schemaObj = schema as Record<string, unknown>;
	if (schemaObj.shape && typeof schemaObj.shape === 'object') {
		return Object.keys(schemaObj.shape as Record<string, unknown>).sort();
	}

	const def = schemaObj._def as Record<string, unknown> | undefined;
	const rawShape = def?.shape;
	if (typeof rawShape === 'function') {
		try {
			const builtShape = rawShape();
			if (builtShape && typeof builtShape === 'object') {
				return Object.keys(builtShape as Record<string, unknown>).sort();
			}
		} catch {
			return [];
		}
	}
	if (rawShape && typeof rawShape === 'object') {
		return Object.keys(rawShape as Record<string, unknown>).sort();
	}

	return [];
}

export function summariseFields(fields: FieldMeta[]): Record<string, unknown> {
	const required = fields.filter((field) => field.required).map((field) => field.id);
	return {
		count: fields.length,
		firstFieldIds: fields.slice(0, 10).map((field) => field.id),
		requiredFieldIds: required.slice(0, 10),
		picklistFieldCount: fields.filter((field) => field.isPickList).length,
		referenceFieldCount: fields.filter((field) => field.isReference).length,
	};
}

function redactScalar(value: unknown): unknown {
	if (typeof value === 'string') {
		if (/token|secret|password|authorization|api[-_]?key/i.test(value)) return '[REDACTED]';
		if (value.length > 120) return `${value.slice(0, 120)}…`;
		return value;
	}
	return value;
}

export function redactForVerbose(value: unknown, depth = 0): unknown {
	if (!AI_TOOL_DEBUG_VERBOSE) return undefined;
	if (depth > 3) return '[TRUNCATED_DEPTH]';
	if (Array.isArray(value)) {
		return value.slice(0, 20).map((item) => redactForVerbose(item, depth + 1));
	}
	if (!value || typeof value !== 'object') return redactScalar(value);
	const input = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(input).slice(0, 50)) {
		if (/token|secret|password|authorization|api[-_]?key/i.test(key)) {
			out[key] = '[REDACTED]';
			continue;
		}
		out[key] = redactForVerbose(raw, depth + 1);
	}
	return out;
}

export function summariseFilters(
	filters: Array<{ field?: unknown; op?: unknown; value?: unknown }>,
): Record<string, unknown> {
	const fieldNames = filters
		.map((f) => (typeof f.field === 'string' ? f.field : undefined))
		.filter(Boolean);
	const ops = filters.map((f) => (typeof f.op === 'string' ? f.op : undefined)).filter(Boolean);
	const valueTypes = filters.map((f) => (Array.isArray(f.value) ? 'array' : typeof f.value));
	return {
		count: filters.length,
		fieldNames: Array.from(new Set(fieldNames)),
		ops: Array.from(new Set(ops)),
		valueTypes,
	};
}

export function summariseResponseEnvelope(serialized: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(serialized) as Record<string, unknown>;
		const isError = parsed.error === true;

		// Determine response shape by top-level discriminator key
		const records = Array.isArray(parsed.records) ? parsed.records : undefined;
		const record = !records && parsed.record && typeof parsed.record === 'object'
			? parsed.record
			: undefined;
		const ticketSummary = !records && !record && parsed.ticketSummary ? parsed.ticketSummary : undefined;

		let resultKind: string;
		if (isError) resultKind = 'error';
		else if (typeof parsed.matchCount === 'number') resultKind = 'count';
		else if (parsed.dryRun === true) resultKind = 'dryRun';
		else if (records !== undefined) resultKind = 'list';
		else if (ticketSummary !== undefined) resultKind = 'ticketSummary';
		else if (parsed.outcome !== undefined) resultKind = 'compound';
		else if (record !== undefined) resultKind = 'mutation';
		else if (parsed.id !== undefined) resultKind = 'mutation';
		else if (parsed.fields !== undefined) resultKind = 'describeFields';
		else if (parsed.picklistValues !== undefined) resultKind = 'listPicklistValues';
		else if (parsed.operationDoc !== undefined) resultKind = 'describeOperation';
		else resultKind = 'unknown';

		return {
			resultKind,
			recordsReturnedCount: typeof parsed.returnedCount === 'number'
				? parsed.returnedCount
				: records?.length ?? 0,
			matchCount: typeof parsed.matchCount === 'number' ? parsed.matchCount : undefined,
			hasMore: typeof parsed.hasMore === 'boolean' ? parsed.hasMore : undefined,
			pendingConfirmationsCount: Array.isArray(parsed.pendingConfirmations)
				? parsed.pendingConfirmations.length
				: 0,
			warningsCount: Array.isArray(parsed.warnings) ? parsed.warnings.length : 0,
			resolvedLabelsCount: Array.isArray(parsed.resolvedLabels)
				? parsed.resolvedLabels.length
				: 0,
			errorType: isError ? parsed.errorType : undefined,
		};
	} catch {
		return { parseError: true };
	}
}

function trace(area: AiTraceEvent['area'], event: Omit<AiTraceEvent, 'ts' | 'area'>): void {
	writeAiTrace({ area, ...event });
}

export const traceToolBuild = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('tool-build', event);
export const traceSchemaBuild = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('schema-build', event);
export const traceDescriptionBuild = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('description-build', event);
export const traceToolCall = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('tool-call', event);
export const traceFilterBuild = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('filter-build', event);
export const traceLabelResolution = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('label-resolution', event);
export const traceWriteGuard = (event: Omit<AiTraceEvent, 'ts' | 'area'>) =>
	trace('write-guard', event);
export const traceResponse = (event: Omit<AiTraceEvent, 'ts' | 'area'>) => trace('response', event);
export const traceExecutor = (event: Omit<AiTraceEvent, 'ts' | 'area'>) => trace('executor', event);
export const traceError = (event: Omit<AiTraceEvent, 'ts' | 'area'>) => trace('error', event);
