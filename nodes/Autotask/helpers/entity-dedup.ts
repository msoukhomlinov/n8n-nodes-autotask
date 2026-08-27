import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractItems, getEntityFieldValue } from './dedup-utils';
import { DedupFieldError } from './compound-errors';
import { getFields } from './entity/api';
import type { IAutotaskField } from '../types/base/entities';
import type { IUdfFieldDefinition } from '../types/base/udf-types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IFindDuplicateOptions {
	/** Autotask entity name for standard-field lookup, e.g. 'Contract', 'ConfigurationItem' */
	entityType: string;
	/** Query endpoint, e.g. 'Contracts/query' */
	queryEndpoint: string;
	/** Filters always applied (scope), e.g. [{ field: 'companyID', op: 'eq', value: 42 }] */
	scopeFilters: Array<{ field: string; op: string; value: unknown }>;
	/** Fields to use for duplicate detection */
	dedupFields: string[];
	/** Values the caller wants to create */
	createFields: Record<string, unknown>;
	/**
	 * Known field types for type-aware comparison (field name → type string).
	 * Any field not listed defaults to UDF metadata lookup, then 'string'.
	 */
	fieldTypeMap?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map AutotaskDataType (string literal or UdfDataType numeric) to compareDedupField type string */
function normaliseDedupType(dataType: unknown): string {
	switch (String(dataType).toLowerCase()) {
		case 'datetime': case '3': return 'datetime';
		case 'date': return 'date';
		case 'double': case 'decimal': case '2': return 'double';
		case 'boolean': case '4': return 'boolean';
		case 'long': return 'long';
		case 'integer': return 'integer';
		default: return 'string';
	}
}

/**
 * Resolve the INPUT value for a dedup field from the create payload.
 * Standard fields live at createFields[field]; UDF values live in
 * createFields.userDefinedFields[] as { name, value } entries (the same
 * {name, value} shape the API returns on records — see getEntityFieldValue).
 * The UDF name match is case-insensitive, mirroring the API-side reader; root
 * keys are checked first (Autotask forbids UDF/standard name collisions, so
 * root-first is safe). Returns undefined when no value was supplied.
 */
function resolveDedupInputValue(createFields: Record<string, unknown>, field: string): unknown {
	if (field in createFields) return createFields[field];
	const udfs = createFields.userDefinedFields as Array<{ name: string; value: unknown }> | undefined;
	if (!Array.isArray(udfs)) return undefined;
	const lower = field.toLowerCase();
	return udfs.find(
		(udf) =>
			udf &&
			typeof udf === 'object' &&
			typeof udf.name === 'string' &&
			udf.name.toLowerCase() === lower,
	)?.value;
}

/** A dedup field whose value is missing/blank can never match a stored record. */
function isDedupValueMissing(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

// ─── Core dedup logic ────────────────────────────────────────────────────────

/**
 * Find a duplicate entity using server-side + client-side filtering.
 *
 * Server-side: scopeFilters always applied. The first *queryable* dedup field is also
 * pushed to the API filter — queryable standard fields use the normal filter shape, UDF
 * fields use { udf: true, field, op, value } (Autotask supports one UDF filter per query).
 * Non-queryable standard fields are skipped for server-side filtering to avoid hard API errors.
 * Remaining dedupFields are evaluated client-side only.
 *
 * Client-side: all dedupFields are compared using getEntityFieldValue() (API side —
 * standard fields from the record root, UDF fields from userDefinedFields[]) against
 * resolveDedupInputValue() (input side — standard fields at createFields[field], UDF
 * values from createFields.userDefinedFields[]). UDF dedup fields therefore use their
 * real supplied values for validation, server-side filtering and comparison (Codex P1).
 * UDF fields whose types are not in fieldTypeMap are looked up via getFields() so that
 * date/number/boolean UDFs receive type-aware normalisation instead of plain string compare.
 */
export async function findDuplicate(
	ctx: IExecuteFunctions,
	options: IFindDuplicateOptions,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	const { entityType, queryEndpoint, scopeFilters, dedupFields, createFields, fieldTypeMap = {} } = options;

	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Determine which fields are standard vs UDF.
	// On failure, degrade gracefully: skip server-side dedup-field narrowing and rely on
	// scope filters + full client-side matching — no harder failure than before this helper existed.
	let standardFieldNames = new Set<string>();
	let queryableStandardFieldNames = new Set<string>();
	let metadataAvailable = false;
	try {
		const standardApiFields = await getFields(entityType, ctx, { fieldType: 'standard' }) as IAutotaskField[];
		standardFieldNames = new Set(standardApiFields.map(f => f.name));
		// P1: only queryable standard fields may be pushed into the API filter
		queryableStandardFieldNames = new Set(
			standardApiFields.filter(f => f.isQueryable).map(f => f.name),
		);
		metadataAvailable = true;
	} catch {
		// Standard field metadata unavailable — skip server-side dedup-field narrowing.
		// Only scope filters applied; client-side comparison still runs across all results.
	}

	// P2: fetch UDF metadata for any UDF dedup fields to get type-aware comparison.
	// Only meaningful when metadata is available — without it, we cannot distinguish UDF from standard.
	// The UDF name set doubles as the phantom-field check below: a dedup field that is
	// neither a standard field nor a UDF field is not a field of the entity at all.
	const udfDedupFields = metadataAvailable ? dedupFields.filter(f => !standardFieldNames.has(f)) : [];
	const udfTypeOverrides: Record<string, string> = {};
	let udfFieldNames: Set<string> | undefined;
	if (udfDedupFields.length > 0) {
		try {
			const udfDefs = await getFields(entityType, ctx, { fieldType: 'udf' }) as IUdfFieldDefinition[];
			udfFieldNames = new Set(udfDefs.map(f => f.name));
			const lowerNames = udfDedupFields.map(f => f.toLowerCase());
			for (const udf of udfDefs) {
				if (lowerNames.includes(udf.name.toLowerCase())) {
					udfTypeOverrides[udf.name.toLowerCase()] = normaliseDedupType(udf.dataType);
				}
			}
		} catch {
			// UDF metadata unavailable — fall back to 'string' comparison for those fields;
			// phantom-field validation for non-standard fields is skipped below.
		}
	}

	// D1: validate dedup fields up front when metadata is available. A dedup field that is
	// not a real field of the entity (phantom), or a real field whose value was dropped
	// from the create payload (no value supplied), can never legitimately match a stored
	// record — and with the both-null non-match rule in compareDedupField it would
	// silently match NOTHING, defeating dedup and creating true duplicates. Fail fast
	// with a precise, actionable error instead. All createIfNotExists creators route
	// through findDuplicate, so this single throw point covers every compound resource.
	// When standard-field metadata is unavailable, keep the previous graceful degradation
	// (scope filters + client-side matching only) — do not hard-fail on metadata errors.
	// The no-value check applies to UDF fields too (Codex P1): UDF input values live in
	// createFields.userDefinedFields[], not at createFields[field] — previously a valid
	// UDF dedup field was never value-checked and was compared as undefined on every
	// record, silently defeating dedup and letting createIfNotExists create duplicates.
	if (metadataAvailable) {
		for (const field of dedupFields) {
			if (!standardFieldNames.has(field) && udfFieldNames && !udfFieldNames.has(field)) {
				throw new DedupFieldError(entityType, field, 'not-a-field');
			}
			const supplied = resolveDedupInputValue(createFields, field);
			if (isDedupValueMissing(supplied)) {
				throw new DedupFieldError(entityType, field, 'no-value');
			}
		}
	}

	// Build API filter: scope + one dedup field for server-side narrowing.
	// Skipped entirely when metadata is unavailable — UDF vs standard classification requires it,
	// and pushing an unclassified field risks an incorrect udf:true flag or a non-queryable error.
	// Prefer a queryable standard field (exact match, no special syntax) over a UDF field.
	// Non-queryable standard fields are intentionally skipped to avoid API errors.
	// Fall back to the first UDF if no queryable standard dedup field has a value.
	// Autotask supports { field, udf: true } for UDF filters — one per query maximum.
	// Values are resolved via resolveDedupInputValue so the udf:true filter carries the
	// real UDF value from createFields.userDefinedFields[], not undefined (Codex P1).
	const apiFilter: Array<Record<string, unknown>> = [...scopeFilters];
	const preferredField = metadataAvailable
		? (dedupFields.find(f => queryableStandardFieldNames.has(f) && resolveDedupInputValue(createFields, f) !== undefined) ??
		   dedupFields.find(f => !standardFieldNames.has(f) && resolveDedupInputValue(createFields, f) !== undefined))
		: undefined;

	if (preferredField) {
		const value = resolveDedupInputValue(createFields, preferredField);
		if (queryableStandardFieldNames.has(preferredField)) {
			apiFilter.push({ field: preferredField, op: 'eq', value });
		} else {
			apiFilter.push({ field: preferredField, udf: true, op: 'eq', value });
		}
	}

	const response = await autotaskApiRequest.call(ctx, 'POST', queryEndpoint, { filter: apiFilter });
	const entities = extractItems(response as IDataObject);

	// Client-side precision match across all dedupFields (standard + UDF)
	for (const entity of entities) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = fieldTypeMap[field] ?? udfTypeOverrides[field.toLowerCase()] ?? 'string';
			// Codex P1: resolve the input value from its real location — standard fields
			// at createFields[field], UDF fields from createFields.userDefinedFields[].
			const inputValue = resolveDedupInputValue(createFields, field);
			const apiValue = getEntityFieldValue(entity, field);

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			return { duplicate: entity, matchedFields: matched };
		}
	}

	return { duplicate: null, matchedFields: [] };
}
