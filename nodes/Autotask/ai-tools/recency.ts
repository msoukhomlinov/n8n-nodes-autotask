import moment from 'moment-timezone';
import type { FieldMeta } from '../helpers/aiHelper';

const RECENCY_WINDOWS_MS: Record<string, number> = {
    last_15m: 15 * 60 * 1000,
    last_1h: 60 * 60 * 1000,
    last_2h: 2 * 60 * 60 * 1000,
    last_3h: 3 * 60 * 60 * 1000,
    last_4h: 4 * 60 * 60 * 1000,
    last_6h: 6 * 60 * 60 * 1000,
    last_8h: 8 * 60 * 60 * 1000,
    last_12h: 12 * 60 * 60 * 1000,
    last_24h: 24 * 60 * 60 * 1000,
    last_1d: 1 * 24 * 60 * 60 * 1000,
    last_2d: 2 * 24 * 60 * 60 * 1000,
    last_3d: 3 * 24 * 60 * 60 * 1000,
    last_4d: 4 * 24 * 60 * 60 * 1000,
    last_5d: 5 * 24 * 60 * 60 * 1000,
    last_6d: 6 * 24 * 60 * 60 * 1000,
    last_7d: 7 * 24 * 60 * 60 * 1000,
    last_14d: 14 * 24 * 60 * 60 * 1000,
    last_30d: 30 * 24 * 60 * 60 * 1000,
    last_90d: 90 * 24 * 60 * 60 * 1000,
};

export const AUTO_RETURN_ALL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const RECENCY_CUSTOM_DAYS_MIN = 1;
const RECENCY_CUSTOM_DAYS_MAX = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ordered preference for which date field to use when the LLM has not specified recency_field. */
const RECENCY_FIELD_PRIORITY = [
	'createDateTime',
	'createDate',
	'lastModifiedDateTime',
	'lastActivityDateTime',
	'lastActivityDate',
	'dateWorked',
] as const;

export interface RecencyFilter {
    field: string;
    op: string;
    value?: string | number | boolean | Array<string | number | boolean>;
    udf?: boolean;
}

export interface RecencyBuildResult {
    filters: RecencyFilter[];
    isActive: boolean;
    note?: string;
    windowMs: number | null;
}

export interface RecencyParams {
    recency?: string;
    recency_field?: string;
    since?: string;
    until?: string;
}

export function parseRecencyWindowMs(recency: string): number {
    const preset = RECENCY_WINDOWS_MS[recency];
    if (preset !== undefined) {
        return preset;
    }
    const match = /^last_(\d+)d$/.exec(recency);
    if (match) {
        const days = parseInt(match[1], 10);
        if (
            Number.isFinite(days) &&
            days >= RECENCY_CUSTOM_DAYS_MIN &&
            days <= RECENCY_CUSTOM_DAYS_MAX
        ) {
            return days * MS_PER_DAY;
        }
    }
    const presets = Object.keys(RECENCY_WINDOWS_MS).join(', ');
    throw new Error(
        `Unsupported recency value '${recency}'. Use a preset (${presets}) or custom last_Nd with N between ${RECENCY_CUSTOM_DAYS_MIN} and ${RECENCY_CUSTOM_DAYS_MAX} (e.g. last_5d, last_45d).`,
    );
}

export function resolveRecencyField(readFields: FieldMeta[], preferredField?: string): string | null {
	if (readFields.length === 0) {
		return null;
	}
	// Explicit LLM-supplied field takes precedence — validate it is a real date field.
	if (preferredField) {
		const explicit = readFields.find(
			(field) =>
				field.id.toLowerCase() === preferredField.toLowerCase() &&
				field.type.toLowerCase().includes('date'),
		);
		if (explicit) {
			return explicit.id;
		}
	}
	// Priority-ordered fallback: deterministic selection across API schema changes.
	const lookup = new Map(readFields.map((f) => [f.id.toLowerCase(), f]));
	for (const candidate of RECENCY_FIELD_PRIORITY) {
		const field = lookup.get(candidate.toLowerCase());
		if (field && !field.udf) {
			return field.id;
		}
	}
	// Final fallback: any non-UDF date field.
	const fallback = readFields.find(
		(field) => !field.udf && field.type.toLowerCase().includes('date'),
	);
	return fallback?.id ?? null;
}

function toUtcIsoSeconds(
    input: string,
    parameterName: 'since' | 'until',
    timezone: string,
): string {
    const parsed = moment.tz(input, timezone);
    if (!parsed.isValid()) {
        throw new Error(
            `Invalid ${parameterName} value '${input}'. Use a date/time string such as ` +
                `2026-01-15T09:00:00 (interpreted as your configured timezone) or ` +
                `2026-01-15T09:00:00Z / 2026-01-15T09:00:00+10:00 (explicit offset respected).`,
        );
    }
    return parsed
        .utc()
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
}

export function buildRecencyFilters(
    params: RecencyParams,
    readFields: FieldMeta[],
    timezone: string,
): RecencyBuildResult {
    const recency = typeof params.recency === 'string' ? params.recency.trim() : '';
    const sinceRaw = typeof params.since === 'string' ? params.since.trim() : '';
    const untilRaw = typeof params.until === 'string' ? params.until.trim() : '';
    const hasRecencyInput = Boolean(recency || sinceRaw || untilRaw);

    if (!hasRecencyInput) {
        return { filters: [], isActive: false, windowMs: null };
    }

    const preferredField = typeof params.recency_field === 'string' ? params.recency_field.trim() : undefined;
    const recencyField = resolveRecencyField(readFields, preferredField);
    if (!recencyField) {
        return {
            filters: [],
            isActive: false,
            note: 'Recency filters were ignored because no datetime field was detected for this resource.',
            windowMs: null,
        };
    }

    let startIso: string | undefined;
    let presetWindowMs: number | undefined;
    if (sinceRaw) {
        startIso = toUtcIsoSeconds(sinceRaw, 'since', timezone);
    } else if (recency) {
        presetWindowMs = parseRecencyWindowMs(recency);
        startIso = new Date(Date.now() - presetWindowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    } else if (untilRaw) {
        throw new Error("The 'until' parameter requires either 'since' or 'recency'.");
    }

    if (!startIso) {
        return { filters: [], isActive: false, windowMs: null };
    }

    const filters: RecencyFilter[] = [
        {
            field: recencyField,
            op: 'gte',
            value: startIso,
        },
    ];

    let endIso: string | undefined;
    if (untilRaw) {
        endIso = toUtcIsoSeconds(untilRaw, 'until', timezone);
        if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
            throw new Error(
                `'until' (${endIso}) must be greater than or equal to 'since' (${startIso}).`,
            );
        }
        filters.push({
            field: recencyField,
            op: 'lte',
            value: endIso,
        });
    }

    let windowMs: number;
    if (sinceRaw && endIso) {
        windowMs = Math.min(new Date(endIso).getTime(), Date.now()) - new Date(startIso).getTime();
    } else if (sinceRaw) {
        windowMs = Date.now() - new Date(startIso).getTime();
    } else {
        // recency preset path — presetWindowMs is guaranteed set here
        windowMs = presetWindowMs as number;
    }

    return { filters, isActive: true, windowMs };
}

export function formatRecencyWindowLabel(recency: string): string | null {
    if (recency === 'last_15m') return 'in the last 15 minutes';
    const hourMatch = /^last_(\d+)h$/.exec(recency);
    if (hourMatch) {
        const n = parseInt(hourMatch[1], 10);
        return `in the last ${n} hour${n === 1 ? '' : 's'}`;
    }
    const dayMatch = /^last_(\d+)d$/.exec(recency);
    if (dayMatch) {
        const n = parseInt(dayMatch[1], 10);
        return `in the last ${n} day${n === 1 ? '' : 's'}`;
    }
    return null;
}
