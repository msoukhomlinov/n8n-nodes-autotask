import type { IDataObject } from 'n8n-workflow';

// ─── Field-type-aware dedup comparison ──────────────────────────────────────

/**
 * Compare a field value from the API response against an input value,
 * using type-appropriate normalisation for accurate duplicate detection.
 */
export function compareDedupField(
	fieldType: string,
	apiValue: unknown,
	inputValue: unknown,
): boolean {
	if (apiValue == null && inputValue == null) return true;
	if (apiValue == null || inputValue == null) return false;

	switch (fieldType) {
		case 'string':
			return String(apiValue).toLowerCase() === String(inputValue).toLowerCase();

		case 'datetime':
		case 'date':
			return normaliseDate(String(apiValue)) === normaliseDate(String(inputValue));

		case 'double':
		case 'decimal':
			return normaliseQuantity(Number(apiValue)) === normaliseQuantity(Number(inputValue));

		case 'boolean':
			return Boolean(apiValue) === Boolean(inputValue);

		case 'integer':
		case 'number':
		case 'long':
			return Number(apiValue) === Number(inputValue);

		default:
			// For reference/picklist or unknown types, use strict numeric equality
			return Number(apiValue) === Number(inputValue);
	}
}

// ─── Normalisation helpers ──────────────────────────────────────────────────

/** Strip time component from an ISO-8601 date, returning YYYY-MM-DD */
export function normaliseDate(value: string): string {
	return value.substring(0, 10);
}

/** Round to 4 decimal places for consistent numeric comparison */
export function normaliseQuantity(value: number): number {
	return Math.round(value * 10000) / 10000;
}

// ─── Response helpers ───────────────────────────────────────────────────────

/** Extract the numeric ID from an Autotask API create/update response */
export function extractId(response: IDataObject): number | null {
	const item = response?.item as IDataObject | undefined;
	const id = item?.itemId ?? item?.id ?? response?.itemId ?? response?.id;
	return typeof id === 'number' && id > 0 ? id : null;
}

/** Safely extract items array from an Autotask API query response */
export function extractItems(response: IDataObject): IDataObject[] {
	const items = (response?.items ?? response?.item ?? []) as IDataObject[] | IDataObject;
	return Array.isArray(items) ? items : [items];
}
