import type { IExecuteFunctions } from 'n8n-workflow';
import { CountOperation } from '../operations/base/count-operation';
import type { IAutotaskEntity } from '../types';
import type { FieldMeta } from '../helpers/aiHelper';
import { buildFieldLookup, coerceFilterValueByFieldType } from './filter-builder';
import type { ToolFilter } from './filter-builder';
import { TYPED_REFERENCE_COMPANION_FIELDS } from '../helpers/typed-reference';
import type { OperationContractViolation } from './operation-contracts';

export const DEFAULT_QUERY_LIMIT = 10;
export const MAX_QUERY_LIMIT = 500;

export function getEffectiveLimit(limit: number | undefined): number {
	if (typeof limit !== 'number' || Number.isNaN(limit)) {
		return DEFAULT_QUERY_LIMIT;
	}
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_QUERY_LIMIT);
}

/**
 * +1 probe truncation helper for convenience handlers (per response-slimming.md Rule 2a).
 *
 * Given a desired `queryLimit` and the raw items fetched (where the upstream call was
 * issued with `MaxRecords = probeLimit(queryLimit)`), returns:
 *  - `items`: sliced back to `queryLimit` records
 *  - `hasMore`: true ONLY when the probe actually returned more than `queryLimit`
 *
 * When `queryLimit === undefined` (returnAll path) the probe is skipped and items pass
 * through unchanged with `hasMore=false`.
 *
 * Edge case: when `queryLimit === MAX_QUERY_LIMIT`, the +1 probe would exceed Autotask's
 * server-side cap, so we skip the probe and fall back to the structural derivation
 * (`items.length >= queryLimit`). This is conservatively correct: at the server cap we
 * already know upstream may have more.
 */
export function probeLimit(queryLimit: number | undefined): number | undefined {
	if (queryLimit === undefined) return undefined;
	if (queryLimit >= MAX_QUERY_LIMIT) return queryLimit;
	return queryLimit + 1;
}

export function applyProbeTruncation<T>(
	items: T[],
	queryLimit: number | undefined,
): { items: T[]; hasMore: boolean } {
	if (queryLimit === undefined) return { items, hasMore: false };
	if (queryLimit >= MAX_QUERY_LIMIT) {
		// Probe was skipped; fall back to structural derivation.
		return { items, hasMore: items.length >= queryLimit };
	}
	if (items.length > queryLimit) {
		return { items: items.slice(0, queryLimit), hasMore: true };
	}
	return { items, hasMore: false };
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

/**
 * Build field values for create/update from params.
 * Only includes actual entity field values, excluding control params.
 */
export function buildFieldValues(
	params: Record<string, unknown>,
	excludeKeys: string[],
	writeFields: FieldMeta[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const writeFieldLookup = buildFieldLookup(writeFields);
	const exclude = new Set<string>([
		...excludeKeys,
		'resource',
		'operation',
		'filter_field',
		'filter_op',
		'filter_value',
		'filter_field_2',
		'filter_op_2',
		'filter_value_2',
		'filter_logic',
		'limit',
		'offset',
		'fields',
		'recency',
		'recency_field',
		'since',
		'until',
		'domain',
		'domainOperator',
		'searchContactEmails',
		'impersonationResourceId',
		'proceedWithoutImpersonationIfDenied',
		'dedupFields',
		'errorOnDuplicate',
		'updateFields',
		'outputMode',
		'targetOperation',
		'filtersJson',
		'returnAll',
		'company',
		'excludeTerminalStatuses', // control flag for getMany on ticket/task/project — not an entity field
		'userDefinedFields', // parsed separately → [{name, value}] array injected after validation
		// Companion fields for typed-reference resolution (ticketLookupField, projectLookupField, ...).
		// These are schema fields consumed by the resolver, never sent to the API.
		...Array.from(TYPED_REFERENCE_COMPANION_FIELDS),
	]);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== '' && !exclude.has(key)) {
			const canonicalField = writeFieldLookup.get(key.toLowerCase());
			result[canonicalField?.id ?? key] = value;
		}
	}
	return result;
}

/**
 * Promote top-level entity fields that are valid READ fields into `eq` filters.
 *
 * The model sometimes passes a parent-scope / read field (e.g. `companyID` on a
 * child resource) as a top-level param expecting it to scope the query. For read
 * operations these are NOT part of any request body — the query body is built from
 * `combinedFilters`, not `fieldValues` — so without promotion the field is silently
 * dropped and the query returns unscoped results.
 *
 * For each non-empty `fieldValues` entry present in `readFields`, this pushes an `eq`
 * filter (using the canonical field id + type-coerced value) and DELETES the entry from
 * `fieldValues` (mutates in place). Empty/blank read-field values (`''`, `null`,
 * `undefined`) are NOT promoted and are left intact so they flow to the downstream leak
 * check rather than being silently dropped. Entries NOT in `readFields` are also left
 * untouched so the leak check still fires on genuine write-only leaks.
 *
 * Caller is responsible for scoping this to generic list operations
 * (getMany / count / getPosted / getUnposted).
 */
export function promoteReadFieldsToFilters(
	fieldValues: Record<string, unknown>,
	readFields: FieldMeta[],
): ToolFilter[] {
	if (readFields.length === 0) return [];
	const readFieldLookup = buildFieldLookup(readFields);
	const promoted: ToolFilter[] = [];
	for (const key of Object.keys(fieldValues)) {
		const canonical = readFieldLookup.get(key.toLowerCase());
		if (!canonical) continue; // not a read field → leave for the leak check
		const rawValue = fieldValues[key];
		// Empty/blank values are never promoted to a filter. Check BEFORE deleting so an
		// empty value is left intact in fieldValues (fail-safe): it then flows to the
		// downstream leak check rather than being silently deleted-and-dropped here.
		if (rawValue === undefined || rawValue === null || rawValue === '') continue;
		delete fieldValues[key];
		promoted.push({
			field: canonical.id,
			op: 'eq',
			value: coerceFilterValueByFieldType(
				rawValue as string | number | boolean | Array<string | number | boolean>,
				canonical.type,
				'eq',
			),
		});
	}
	return promoted;
}

/**
 * True when `filterField` is already covered by a value-bearing filter in `filters`.
 *
 * A model often restates a field it has already scoped via a top-level read-field param
 * (e.g. `companyID` on a child resource — promoted to an eq filter by
 * `promoteReadFieldsToFilters`) by ALSO naming it in `filter_field` with an empty
 * `filter_value`. That incomplete triple is a redundant restatement, not a broken filter,
 * so the pre-flight "requires filter_value" validation must not reject it. Only filters
 * carrying a real value (headed for the API) count as coverage — a value-less filter never
 * lands in `filters`, so a genuinely incomplete filter is never treated as covered.
 * Case-insensitive to match the canonical casing promotion normalises to.
 */
export function isFilterFieldCovered(filterField: string, filters: ToolFilter[]): boolean {
	const target = filterField.toLowerCase();
	return filters.some(
		(f) => f.value !== undefined && f.value !== '' && f.field.toLowerCase() === target,
	);
}

/**
 * Parse the 'fields' param into a selectColumns-compatible array.
 */
export function parseFieldsParam(fields: string | undefined): string[] {
	if (!fields || typeof fields !== 'string') return [];
	return fields
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean);
}

/**
 * Strip virtual label-suffix columns (_label, _name) from a selectedColumns list,
 * re-injecting the canonical base field from readFields when it exists.
 * Silent — no warnings emitted. Mirrors include-fields.ts behaviour for the AI tools path.
 */
export function resolveVirtualLabelFields(
	columns: string[],
	readFields: FieldMeta[],
): string[] {
	const readFieldMap = new Map(readFields.map((f) => [f.id.toLowerCase(), f.id]));
	const result: string[] = [];
	const seen = new Set<string>();

	for (const column of columns) {
		let effective = column;
		if (column.endsWith('_label') || column.endsWith('_name')) {
			const suffix = column.endsWith('_label') ? '_label' : '_name';
			const baseRaw = column.slice(0, -suffix.length);
			const canonical = readFieldMap.get(baseRaw.toLowerCase());
			if (!canonical) continue; // base not in readFields — drop silently
			effective = canonical;
		}
		const lower = effective.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			result.push(effective);
		}
	}
	return result;
}

/**
 * Normalise operation names to canonical forms used by the executor.
 */
export function normaliseOperation(operation: string): string {
	const key = operation.trim().toLowerCase();
	switch (key) {
		case 'getmany':
			return 'getMany';
		case 'whoami':
			return 'whoAmI';
		case 'getposted':
			return 'getPosted';
		case 'getunposted':
			return 'getUnposted';
		case 'searchbydomain':
			return 'searchByDomain';
		case 'searchbyidentity':
			return 'searchByIdentity';
		case 'slahealthcheck':
			return 'slaHealthCheck';
		case 'moveconfigurationitem':
			return 'moveConfigurationItem';
		case 'movetocompany':
			return 'moveToCompany';
		case 'transferownership':
			return 'transferOwnership';
		case 'createifnotexists':
			return 'createIfNotExists';
		case 'getbyresource':
			return 'getByResource';
		case 'getavailableroles':
			return 'getAvailableRoles';
		case 'getbyyear':
			return 'getByYear';
		case 'getbycompanyandstatus':
			return 'getByCompanyAndStatus';
		case 'getunassigned':
			return 'getUnassigned';
		case 'getbyslastatus':
			return 'getBySLAStatus';
		case 'getfulldetail':
			return 'getFullDetail';
		case 'countbyperiod':
			return 'countByPeriod';
		case 'getbyage':
			return 'getByAge';
		case 'searchbykeyword':
			return 'searchByKeyword';
		case 'searchnotes':
			return 'searchNotes';
		case 'describeoperation':
			return 'describeOperation';
		case 'describefields':
			return 'describeFields';
		case 'listpicklistvalues':
			return 'listPicklistValues';
		default:
			return key;
	}
}

export function buildContractViolationNextAction(
	resource: string,
	operation: string,
	violations: OperationContractViolation[],
): string {
	return (
		`Call autotask_${resource} with operation '${operation}' and ensure: ` +
		violations.map((v) => v.message).join(' ')
	);
}
