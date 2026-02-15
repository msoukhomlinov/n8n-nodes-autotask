import type { IExecuteFunctions } from 'n8n-workflow';
import type { IDataObject } from 'n8n-workflow';
import type { IAutotaskField } from '../../types/base/entities';
import { getFields } from './api';

/**
 * Returns the set of field names that are writable (not read-only) for a
 * given entity, as reported by the Autotask Field Info API.
 *
 * Callers building "copy" payloads should iterate ONLY these field names
 * rather than iterating the source object's keys with a hardcoded exclusion list.
 */
export async function getWritableFieldNames(
	entityType: string,
	context: IExecuteFunctions,
): Promise<Set<string>> {
	const fields = await getFields(entityType, context) as IAutotaskField[];
	return new Set(
		fields.filter(f => !f.isReadOnly).map(f => f.name),
	);
}

/**
 * Returns a map of required writable field names to their default values,
 * as reported by the Autotask Field Info API.
 *
 * For required picklist fields the default is the field's `isDefaultValue`
 * entry, falling back to the first active picklist value.  For non-picklist
 * required fields the value is `undefined` (caller must supply a value).
 *
 * Use this when building a payload from scratch (e.g. audit notes) to
 * ensure every required field the API expects is present.
 */
export async function getRequiredFieldDefaults(
	entityType: string,
	context: IExecuteFunctions,
): Promise<Map<string, unknown>> {
	const fields = await getFields(entityType, context) as IAutotaskField[];
	const defaults = new Map<string, unknown>();

	for (const f of fields) {
		if (f.isReadOnly || !f.isRequired) continue;

		if (f.isPickList && Array.isArray(f.picklistValues)) {
			const activeValues = f.picklistValues.filter(v => v.isActive);
			const defaultEntry = activeValues.find(v => v.isDefaultValue);
			const fallback = activeValues.length > 0 ? activeValues[0] : undefined;
			const picked = defaultEntry ?? fallback;
			defaults.set(f.name, picked ? picked.value : undefined);
		} else {
			defaults.set(f.name, undefined);
		}
	}

	return defaults;
}

/**
 * Fills missing required fields in a payload using API-driven defaults.
 * Only sets fields that are absent or `undefined` in the payload — never
 * overwrites values the caller has already set.  Warns for any required
 * field that still has no value after applying defaults.
 */
export async function applyRequiredFieldDefaults(
	entityType: string,
	context: IExecuteFunctions,
	payload: IDataObject,
	warnings: string[],
): Promise<void> {
	const defaults = await getRequiredFieldDefaults(entityType, context);

	for (const [name, defaultValue] of defaults) {
		if (payload[name] !== undefined && payload[name] !== null) continue;
		if (defaultValue !== undefined) {
			payload[name] = defaultValue as IDataObject;
			continue;
		}
		// No default available — warn but don't block; the API will reject
		// if the field is truly mandatory.
		warnings.push(`Required field "${name}" on ${entityType} has no value and no default could be determined.`);
	}
}
