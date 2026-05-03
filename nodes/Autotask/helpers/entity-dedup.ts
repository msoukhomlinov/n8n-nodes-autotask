import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractItems, getEntityFieldValue } from './dedup-utils';
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
 * Client-side: all dedupFields are compared using getEntityFieldValue(), which reads
 * standard fields from the record root and UDF fields from userDefinedFields[].
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
	try {
		const standardApiFields = await getFields(entityType, ctx, { fieldType: 'standard' }) as IAutotaskField[];
		standardFieldNames = new Set(standardApiFields.map(f => f.name));
		// P1: only queryable standard fields may be pushed into the API filter
		queryableStandardFieldNames = new Set(
			standardApiFields.filter(f => f.isQueryable).map(f => f.name),
		);
	} catch {
		// Standard field metadata unavailable — treat all dedup fields as unclassified.
		// Server-side narrowing is skipped; client-side comparison still runs.
	}

	// P2: fetch UDF metadata for any UDF dedup fields to get type-aware comparison
	const udfDedupFields = dedupFields.filter(f => !standardFieldNames.has(f));
	const udfTypeOverrides: Record<string, string> = {};
	if (udfDedupFields.length > 0) {
		try {
			const udfDefs = await getFields(entityType, ctx, { fieldType: 'udf' }) as IUdfFieldDefinition[];
			const lowerNames = udfDedupFields.map(f => f.toLowerCase());
			for (const udf of udfDefs) {
				if (lowerNames.includes(udf.name.toLowerCase())) {
					udfTypeOverrides[udf.name.toLowerCase()] = normaliseDedupType(udf.dataType);
				}
			}
		} catch {
			// UDF metadata unavailable — fall back to 'string' comparison for those fields
		}
	}

	// Build API filter: scope + one dedup field for server-side narrowing.
	// Prefer a queryable standard field (exact match, no special syntax) over a UDF field.
	// Non-queryable standard fields are intentionally skipped to avoid API errors.
	// Fall back to the first UDF if no queryable standard dedup field has a value.
	// Autotask supports { field, udf: true } for UDF filters — one per query maximum.
	const apiFilter: Array<Record<string, unknown>> = [...scopeFilters];
	const preferredField =
		dedupFields.find(f => queryableStandardFieldNames.has(f) && createFields[f] !== undefined) ??
		dedupFields.find(f => !standardFieldNames.has(f) && createFields[f] !== undefined);

	if (preferredField) {
		if (queryableStandardFieldNames.has(preferredField)) {
			apiFilter.push({ field: preferredField, op: 'eq', value: createFields[preferredField] });
		} else {
			apiFilter.push({ field: preferredField, udf: true, op: 'eq', value: createFields[preferredField] });
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
			const inputValue = createFields[field];
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
