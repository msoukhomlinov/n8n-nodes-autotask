import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FieldMeta } from '../helpers/aiHelper';

export const AI_TOOL_DEBUG_ENABLED = true;
export const AI_TOOL_DEBUG_VERBOSE = true;
export const AI_TOOL_DEBUG_FILE_PATH = join(tmpdir(), 'autotask-ai-tool-debug.jsonl');

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
		appendFile(AI_TOOL_DEBUG_FILE_PATH, line, 'utf8').catch(() => {
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
		const payload = parsed.result as Record<string, unknown> | undefined;
		const data = payload?.data as Record<string, unknown> | undefined;
		const flags = (payload?.flags ?? {}) as Record<string, unknown>;
		const error = parsed.error as Record<string, unknown> | undefined;
		const items = Array.isArray(data?.items) ? data.items : [];
		return {
			resultKind: payload?.kind,
			recordsReturnedCount: items.length,
			recordsFetchedCount: typeof data?.count === 'number' ? data.count : undefined,
			truncated: flags.truncated,
			partial: flags.partial,
			retryable: flags.retryable,
			mutated: flags.mutated,
			pendingConfirmationsCount: Array.isArray(payload?.pendingConfirmations)
				? payload.pendingConfirmations.length
				: 0,
			warningsCount: Array.isArray(payload?.warnings) ? payload.warnings.length : 0,
			appliedResolutionsCount: Array.isArray(payload?.appliedResolutions)
				? payload.appliedResolutions.length
				: 0,
			errorType: error?.type,
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
