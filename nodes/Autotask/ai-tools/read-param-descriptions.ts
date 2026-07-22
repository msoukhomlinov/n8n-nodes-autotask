import { MAX_RESPONSE_RECORDS } from './operation-handlers/operation-dispatch';

/**
 * Single-source descriptions for read-family params that recur across many
 * operations (getMany, count, getPosted, getUnposted, getByResource, getByYear,
 * ticket.getByResource) and both consumers (schema-generator.ts Zod .describe(),
 * description-builders.ts READ_OP_PARAMS). `filter_field` is excluded — it is
 * resource-branched (enum of real field names vs plain string fallback) and stays
 * local to schema-generator.ts.
 */
export const READ_PARAM_DESC = {
	filter_op:
		"Filter operator (optional, default 'eq'). 'notExist' matches empty/null fields, 'exist' matches populated — neither needs filter_value. Others: eq, noteq, gt, gte, lt, lte, contains, beginsWith, endsWith, in, notIn.",
	filter_op_2: "Second filter operator (optional, default 'eq').",
	filter_value:
		"Filter value. Required with filter_field (not needed when filter_op is 'exist' or 'notExist'). Reference/picklist fields: pass the human-readable name (e.g. 'In Progress') — auto-resolved to ID, or pass a numeric ID directly. in/notIn: comma-separate values; each name resolved independently (see resolvedElements/pendingConfirmations in the response). Booleans: 'true'/'false'.",
	filter_value_2:
		"Second filter value. Required with filter_field_2 (not needed when filter_op_2 is 'exist' or 'notExist').",
	filter_field_2:
		'Second filter field. Provide filter_value_2 with it, or omit the second filter entirely. Requires the first filter. Same field names as filter_field.',
	filter_logic:
		"Combine the two filter pairs: 'and' (default) or 'or'. Valid only when both pairs are supplied — sending it with one pair is rejected.",
	limit: 'Max results (1-500, default 10).',
	offset:
		'Skip first N records (0-499). Response includes hasMore/nextOffset. Max 500 total — narrow filters for more.',
	recency:
		'Preset time window: last_15m, last_1h, last_2h, last_3h, last_4h, last_6h, last_8h, last_12h, last_24h, last_1d–last_7d, last_14d, last_30d, last_90d. Or last_Nd (N=1–365). Mutually exclusive with since/until.',
	since:
		'Range start (ISO-8601 UTC). Lower bound — records at or after this. Mutually exclusive with recency.',
	until:
		'Range end (ISO-8601 UTC). Requires since or recency. Mutually exclusive with recency.',
	outputMode:
		"'idsAndLabels' (default) appends derived label fields — do NOT list these in fields. 'rawIds' returns numeric IDs only.",
} as const;

export function fieldsDesc(): string {
	return (
		'Sparse fieldset — comma-separated field names to return. Omit for all fields; id is always included. ' +
		`With returnAll=true, specifying fields lifts the ${MAX_RESPONSE_RECORDS}-record payload cap. ` +
		'Real API field names only (call describeFields for the list). Do not request *_label/*_name fields — auto-added by outputMode=idsAndLabels.'
	);
}

export function filtersJsonDesc(): string {
	return (
		'Advanced filters as a JSON array of condition objects. Mutually exclusive with filter_field/filter_field_2. No label resolution — use numeric IDs. ' +
		'Each condition: {"field":"<name>","op":"<op>","value":<value>}. Nested AND/OR: {"op":"and"|"or","items":[<cond>,...]}. ' +
		'in/notIn value is a JSON array (max 500). Call describeFields for field names, listPicklistValues for picklist IDs.'
	);
}

export function returnAllDesc(): string {
	return `Fetch all matching records via cursor pagination. Default false = up to limit. Without fields, payload caps at ${MAX_RESPONSE_RECORDS}; with fields, cap lifted.`;
}
