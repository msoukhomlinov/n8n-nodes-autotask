import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractItems, getEntityFieldValue } from './dedup-utils';
import { getFields } from './entity/api';
import type { IAutotaskField } from '../types/base/entities';

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
	 * Any field not listed defaults to 'string'.
	 */
	fieldTypeMap?: Record<string, string>;
}

// ─── Core dedup logic ────────────────────────────────────────────────────────

/**
 * Find a duplicate entity using server-side + client-side filtering.
 *
 * Server-side: scopeFilters always applied. The first dedupField is also pushed
 * to the API filter — standard fields use the normal filter shape, UDF fields use
 * { udf: true, field, op, value } (Autotask supports one UDF filter per query).
 * Remaining dedupFields are evaluated client-side only.
 *
 * Client-side: all dedupFields are compared using getEntityFieldValue(), which
 * reads standard fields from the record root and UDF fields from userDefinedFields[].
 */
export async function findDuplicate(
	ctx: IExecuteFunctions,
	options: IFindDuplicateOptions,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	const { entityType, queryEndpoint, scopeFilters, dedupFields, createFields, fieldTypeMap = {} } = options;

	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Determine which fields are standard vs UDF
	const standardApiFields = await getFields(entityType, ctx, { fieldType: 'standard' }) as IAutotaskField[];
	const standardFieldNames = new Set(standardApiFields.map(f => f.name));

	// Build API filter: scope + one dedup field for server-side narrowing.
	// Prefer a standard field (exact match, no special syntax) over a UDF field.
	// Fall back to the first UDF if no standard dedup field has a value.
	// Autotask supports { field, udf: true } for UDF filters — one per query maximum.
	const apiFilter: Array<Record<string, unknown>> = [...scopeFilters];
	const preferredField =
		dedupFields.find(f => standardFieldNames.has(f) && createFields[f] !== undefined) ??
		dedupFields.find(f => !standardFieldNames.has(f) && createFields[f] !== undefined);

	if (preferredField) {
		if (standardFieldNames.has(preferredField)) {
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
			const fieldType = fieldTypeMap[field] ?? 'string';
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
