import type { INodeProperties } from 'n8n-workflow';

/**
 * Merges duplicate node properties that differ only in `displayOptions.show.resource`.
 *
 * Many properties (returnAll, maxRecords, selectColumns, etc.) are emitted once per
 * resource by `addOperationsToResource`, producing ~1,300 properties where ~300 would
 * suffice.  n8n's `displayOptions.show.resource` natively accepts an array, so we can
 * merge `resource: ['ticket']` + `resource: ['company']` → `resource: ['ticket', 'company']`.
 *
 * This reduces the serialised node-description payload by ~75 %, eliminating the UI
 * freeze reported in GitHub issue #22.
 *
 * Ordering strategy:
 *   1. Pass-through properties (no single-resource displayOption) keep their original position.
 *   2. Properties that remain unique after fingerprinting (only one resource) keep their
 *      original position — these are per-resource operation dropdowns, id fields, etc.
 *   3. Properties that were merged across multiple resources are appended at the end,
 *      in the relative order of their first occurrence.  This guarantees that per-resource
 *      `operation` dropdowns always appear *before* the shared fields (returnAll,
 *      maxRecords, selectColumns …) in n8n's UI.
 */
export function consolidateProperties(properties: INodeProperties[]): INodeProperties[] {
	/** Map from fingerprint → { property (first occurrence), resourceValues } */
	const groups = new Map<string, { property: INodeProperties; resources: string[] }>();
	/** Insertion-order list of fingerprints */
	const order: string[] = [];
	/** Original positions for pass-through + single-resource items */
	const headItems: INodeProperties[] = [];

	for (const prop of properties) {
		const resourceArr = prop.displayOptions?.show?.resource;

		// Only consolidate properties whose resource filter is a single-element array
		// of strings.  Everything else passes through unchanged.
		if (
			!Array.isArray(resourceArr) ||
			resourceArr.length !== 1 ||
			typeof resourceArr[0] !== 'string'
		) {
			headItems.push(prop);
			continue;
		}

		const resourceValue = resourceArr[0] as string;
		const fingerprint = buildFingerprint(prop);

		const existing = groups.get(fingerprint);
		if (existing) {
			// Merge: just add the resource value
			if (!existing.resources.includes(resourceValue)) {
				existing.resources.push(resourceValue);
			}
		} else {
			groups.set(fingerprint, { property: prop, resources: [resourceValue] });
			order.push(fingerprint);
		}
	}

	// Split groups into single-resource (keep in place) vs multi-resource (append at end).
	// Single-resource groups are properties unique to one resource (e.g. per-resource
	// operation dropdowns, resource-specific id fields).  They need to stay in their
	// original position relative to each other and to pass-through items.
	//
	// We interleave single-resource items with pass-through items by replaying the
	// original property order one more time.
	const result: INodeProperties[] = [];
	const tailItems: INodeProperties[] = []; // multi-resource consolidated properties

	// Separate groups
	const singleResourceFingerprints = new Set<string>();
	const multiResourceFingerprints = new Set<string>();
	for (const fp of order) {
		const group = groups.get(fp)!;
		if (group.resources.length === 1) {
			singleResourceFingerprints.add(fp);
		} else {
			multiResourceFingerprints.add(fp);
		}
	}

	// Replay original order to interleave pass-through + single-resource items
	const emittedFingerprints = new Set<string>();
	for (const prop of properties) {
		const resourceArr = prop.displayOptions?.show?.resource;

		if (
			!Array.isArray(resourceArr) ||
			resourceArr.length !== 1 ||
			typeof resourceArr[0] !== 'string'
		) {
			// Pass-through
			result.push(prop);
			continue;
		}

		const fingerprint = buildFingerprint(prop);

		if (emittedFingerprints.has(fingerprint)) {
			continue; // Already emitted (duplicate)
		}

		if (singleResourceFingerprints.has(fingerprint)) {
			// Single-resource: keep in original position (not consolidated)
			result.push(prop);
			emittedFingerprints.add(fingerprint);
		} else if (multiResourceFingerprints.has(fingerprint)) {
			// Multi-resource: will be appended at end; skip for now but mark as seen
			emittedFingerprints.add(fingerprint);
		}
	}

	// Append consolidated multi-resource properties at the end, in first-occurrence order
	for (const fp of order) {
		if (!multiResourceFingerprints.has(fp)) continue;
		const group = groups.get(fp)!;
		tailItems.push({
			...group.property,
			displayOptions: {
				...group.property.displayOptions,
				show: {
					...group.property.displayOptions?.show,
					resource: group.resources.sort(),
				},
			},
		});
	}

	return [...result, ...tailItems];
}

/**
 * Creates a canonical string fingerprint of a property, excluding
 * `displayOptions.show.resource`.  Two properties with the same fingerprint
 * are identical in every way except which resource(s) they apply to.
 */
function buildFingerprint(prop: INodeProperties): string {
	// Deep-clone displayOptions.show without 'resource'
	const show = prop.displayOptions?.show;
	const showWithoutResource: Record<string, unknown> = {};
	if (show) {
		for (const key of Object.keys(show)) {
			if (key === 'resource') continue;
			const val = (show as Record<string, unknown>)[key];
			// Sort arrays for consistency
			showWithoutResource[key] = Array.isArray(val) ? [...val].sort() : val;
		}
	}

	// Build a stripped-down object for fingerprinting
	const fp: Record<string, unknown> = {
		name: prop.name,
		type: prop.type,
		displayName: prop.displayName,
		default: prop.default,
		description: prop.description,
		show: showWithoutResource,
	};

	// Include other distinguishing fields if present
	if (prop.typeOptions) fp.typeOptions = prop.typeOptions;
	if (prop.options) fp.options = prop.options;
	if (prop.required !== undefined) fp.required = prop.required;
	if (prop.noDataExpression !== undefined) fp.noDataExpression = prop.noDataExpression;
	if (prop.placeholder !== undefined) fp.placeholder = prop.placeholder;
	if (prop.hint !== undefined) fp.hint = prop.hint;
	if (prop.displayOptions?.hide) fp.hide = prop.displayOptions.hide;

	return JSON.stringify(fp);
}
