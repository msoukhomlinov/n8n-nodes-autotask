# createIfNotExists Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `createIfNotExists` with the `create` operation pattern — use dynamic resourceMapper/entity-metadata for fields instead of hardcoded field definitions, keeping only `dedupFields` + `errorOnDuplicate` as operation-specific additions.

**Architecture:** Replace hardcoded field lists in charge-creator-base.ts interface, description.ts, execute.ts, schema-generator.ts, and tool-executor.ts with the same dynamic field patterns used by `create`. The `createFields: Record<string, unknown>` approach means keys are API field names (e.g., `name` not `chargeName`), which eliminates `fieldNameToApiName` mappings entirely.

**Tech Stack:** TypeScript, n8n node SDK (resourceMapper, INodeProperties), Zod (runtime schema via runtimeZod)

**Spec:** `docs/superpowers/specs/2026-03-19-createIfNotExists-alignment-design.md`

**Scope:** contractCharge first (Tasks 1-6), then remaining 6 entities (Tasks 7-9).

**Important notes:**
- **Task atomicity:** Tasks 1-3 MUST be applied together before a build will pass — the interface change in Task 1 breaks consumers until Tasks 2-3 update them. Do NOT attempt to build between Tasks 1 and 3.
- **AI tools field name change:** After this refactor, the AI tools schema will show API field names (e.g., `name` instead of `chargeName`, `isBillableToCompany` instead of `isBillable`). This is a user-visible change for LLM prompts that reference old aliases. Document in CHANGELOG.
- **`needsWriteFields` prerequisite:** `AutotaskAiTools.node.ts` line 165 already includes `createIfNotExists` in `needsWriteFields`. This ensures `writeFields` metadata is fetched and passed to `buildUnifiedSchema`. Verify this is still true before starting Task 4.

---

## File Structure

| File | Change | Responsibility |
|------|--------|---------------|
| `helpers/charge-creator-base.ts` | Modify | Simplify `IChargeCreateIfNotExistsOptions` to `{ createFields, dedupFields, errorOnDuplicate }`. Update all 4 step functions to use `createFields` record. Remove `getOptionValue()` and `fieldNameToApiName`. |
| `helpers/contract-charge-creator.ts` | Modify | Update config (`fieldTypeMap` keys to API names, remove `fieldNameToApiName`). Update wrapper to pass `createFields`. |
| `resources/contractCharges/description.ts` | Modify | Remove 11 hardcoded fields, add `createIfNotExists` to `fieldsToMap` displayOptions. Keep `dedupFields` + `errorOnDuplicate`. |
| `resources/contractCharges/execute.ts` | Modify | Replace 11 `getNodeParameter()` calls with resourceMapper read. |
| `ai-tools/schema-generator.ts` | Modify | Remove hardcoded charge field block for `createIfNotExists`. Reuse dynamic `writeFields` loop. Add `dedupFields` + `errorOnDuplicate` only. |
| `ai-tools/tool-executor.ts` | Modify | Simplify contractCharge short-circuit: use `buildFieldValues()` + `validateWriteFields()` + `resolveLabelsToIds()`, then pass `{ createFields, dedupFields, errorOnDuplicate }`. |
| `ai-tools/description-builders.ts` | Modify | Simplify createIfNotExists descriptions (no field enumeration). |
| `helpers/ticket-charge-creator.ts` | Modify | Same interface simplification as contract-charge-creator. |
| `helpers/project-charge-creator.ts` | Modify | Same interface simplification. |
| `resources/ticketCharges/description.ts` | Modify | Same pattern as contractCharges. |
| `resources/ticketCharges/execute.ts` | Modify | Same pattern as contractCharges. |
| `resources/projectCharges/description.ts` | Modify | Same pattern as contractCharges. |
| `resources/projectCharges/execute.ts` | Modify | Same pattern as contractCharges. |
| `helpers/configuration-item-creator.ts` | Modify | Simplify interface to `{ createFields, dedupFields, errorOnDuplicate }`. |
| `helpers/time-entry-creator.ts` | Modify | Same interface simplification. |
| `helpers/contract-service-creator.ts` | Modify | Same interface simplification. |
| `helpers/contract-creator.ts` | Modify | Same interface simplification. |
| `resources/configurationItems/description.ts` | Modify | Remove hardcoded fields. |
| `resources/configurationItems/execute.ts` | Modify | Use resourceMapper read. |
| `resources/timeEntries/description.ts` | Modify | Remove hardcoded fields. |
| `resources/timeEntries/execute.ts` | Modify | Use resourceMapper read. |
| `resources/contractServices/description.ts` | Modify | Remove hardcoded fields. |
| `resources/contractServices/execute.ts` | Modify | Use resourceMapper read. |
| `resources/contracts/description.ts` | Modify | Remove hardcoded fields. |
| `resources/contracts/execute.ts` | Modify | Use resourceMapper read. |

---

### Task 1: Simplify `charge-creator-base.ts` interface and internals

**Files:**
- Modify: `nodes/Autotask/helpers/charge-creator-base.ts`

This is the foundation — all charge entities depend on these interfaces.

- [ ] **Step 1: Replace `IChargeCreateIfNotExistsOptions` interface**

Replace the current 15-field interface (lines 7-22) with:

```typescript
export interface IChargeCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}
```

- [ ] **Step 2: Remove `fieldNameToApiName` from `ChargeCreatorConfig`**

Remove line 62 (`fieldNameToApiName?: Record<string, string>;`) and its JSDoc comment (line 61) from the `ChargeCreatorConfig` interface. Also remove the JSDoc on `fieldTypeMap` (lines 58-59) that mentions "maps API field names to input option names" — update to just: `/** Maps API field name to its data type for dedup comparison */`.

- [ ] **Step 3: Update `findDuplicateCharge()` to use `createFields`**

Current code (lines 96-152) references `options.chargeName` and uses `fieldNameToApiName`. Replace with:

```typescript
export async function findDuplicateCharge(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentId: number,
	options: IChargeCreateIfNotExistsOptions,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	const { dedupFields, createFields } = options;

	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// API filter: always filter by parent ID, plus name if in dedupFields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: config.chargeParentIdField, op: 'eq', value: parentId },
	];
	if (dedupFields.includes('name') && createFields.name) {
		apiFilter.push({ field: 'name', op: 'eq', value: createFields.name });
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', config.chargeQueryEndpoint, { filter: apiFilter },
	);

	const charges = extractItems(response as IDataObject);
	const fieldTypeMap = config.fieldTypeMap ?? {};

	// Client-side precision match on ALL selected dedupFields
	for (const charge of charges) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = fieldTypeMap[field] ?? 'string';
			const inputValue = createFields[field];
			const apiValue = charge[field];

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			return { duplicate: charge, matchedFields: matched };
		}
	}

	return { duplicate: null, matchedFields: [] };
}
```

Key changes: `createFields[field]` replaces `getOptionValue(options, field)`. `charge[field]` replaces `charge[apiFieldName]`. No `fieldNameToApiName` lookup.

- [ ] **Step 4: Update `resolveBillingCodeId()` to accept `createFields`**

Replace current signature (lines 157-205) — change `options: IChargeCreateIfNotExistsOptions` to `createFields: Record<string, unknown>`:

```typescript
export async function resolveBillingCodeId(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
): Promise<{ billingCodeID: number | undefined; warnings: string[] }> {
	const warnings: string[] = [];
	const billingCodeID = createFields.billingCodeID as number | undefined;
	const materialCode = createFields.materialCode as string | undefined;

	if (billingCodeID !== undefined && materialCode) {
		warnings.push(
			'Both materialCode and billingCodeID provided. Using billingCodeID directly; materialCode ignored.',
		);
		return { billingCodeID, warnings };
	}

	if (billingCodeID !== undefined) {
		return { billingCodeID, warnings };
	}

	if (!materialCode) {
		// Neither provided — billing code resolution is optional
		return { billingCodeID: undefined, warnings };
	}

	// Lookup by materialCode
	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'BillingCodes/query',
		{ filter: [{ field: 'materialCode', op: 'eq', value: materialCode }] },
	);

	const codes = extractItems(response as IDataObject);

	if (codes.length === 0) {
		throw new Error(
			`BillingCode with materialCode '${materialCode}' not found. Verify the material code or provide billingCodeID directly.`,
		);
	}

	const activeCodes = codes.filter(c => c.isActive !== false);
	const chosen = activeCodes.length > 0 ? activeCodes[0] : codes[0];

	if (codes.length > 1) {
		warnings.push(
			`Multiple BillingCodes (${codes.length}) found for materialCode '${materialCode}'. Using first active (ID: ${chosen.id}).`,
		);
	}

	return { billingCodeID: chosen.id as number, warnings };
}
```

Key changes: accepts `createFields` record instead of options object. Returns `undefined` billingCodeID when neither field provided (instead of throwing).

- [ ] **Step 5: Update `createCharge()` to spread `createFields`**

Replace current body construction (lines 210-252):

```typescript
export async function createCharge(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentId: number,
	billingCodeID: number | undefined,
	options: IChargeCreateIfNotExistsOptions,
): Promise<number> {
	// Build body from createFields, overriding parent ID and resolved billing code
	const body: IDataObject = {
		...options.createFields,
		[config.chargeParentIdField]: parentId,
	};

	// Override billingCodeID if resolved
	if (billingCodeID !== undefined) {
		body.billingCodeID = billingCodeID;
	}

	// Strip non-API fields
	delete body.materialCode;      // helper-level lookup key, not an API field
	delete body.dedupFields;       // defense-in-depth: should not be in createFields
	delete body.errorOnDuplicate;  // defense-in-depth: should not be in createFields

	// Strip the parent lookup field if it's not an API field on the charge entity
	// (e.g. externalServiceIdentifier belongs to Contract, not ContractCharge)
	if (config.parentLookupField !== config.chargeParentIdField) {
		delete body[config.parentLookupField];
	}

	const endpoint = config.chargeCreateEndpointTemplate.replace('{parentId}', String(parentId));

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		endpoint,
		body,
		{},
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied ?? true,
	);

	const chargeId = extractId(response as IDataObject);
	if (!chargeId) {
		throw new Error('Charge creation succeeded but returned no ID.');
	}
	return chargeId;
}
```

Key changes: spread `createFields` as body. Override `billingCodeID` if resolved. Strip `materialCode` and parent lookup field from body.

- [ ] **Step 6: Update `createChargeIfNotExists()` orchestrator**

Replace current orchestrator (lines 257-325) to use `createFields` for return values:

```typescript
export async function createChargeIfNotExists(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentLookupValue: string,
	options: IChargeCreateIfNotExistsOptions,
): Promise<IChargeCreateResult> {
	const warnings: string[] = [];

	// Step 1: Find parent
	const { parents, warnings: parentWarnings } = await findParentEntity(
		ctx, config, parentLookupValue,
	);
	warnings.push(...parentWarnings);

	if (parents.length === 0) {
		return {
			outcome: 'parent_not_found',
			parentLookupValue,
			chargeName: (options.createFields.name as string) ?? '',
			datePurchased: (options.createFields.datePurchased as string) ?? '',
			warnings,
		};
	}

	const parentId = parents[0].id as number;

	// Step 2: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateCharge(ctx, config, parentId, options);

	if (duplicate) {
		if (options.errorOnDuplicate) {
			throw new Error(
				`Duplicate charge found (ID: ${duplicate.id}) on ${config.parentEntityLabel} ${parentId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}
		return {
			outcome: 'skipped',
			reason: 'duplicate_charge',
			existingChargeId: duplicate.id as number,
			parentId,
			parentLookupValue,
			chargeName: (options.createFields.name as string) ?? '',
			datePurchased: (options.createFields.datePurchased as string) ?? '',
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Resolve billing code
	const { billingCodeID, warnings: billingWarnings } = await resolveBillingCodeId(ctx, options.createFields);
	warnings.push(...billingWarnings);

	// Step 4: Create charge
	const chargeId = await createCharge(ctx, config, parentId, billingCodeID, options);

	return {
		outcome: 'created',
		chargeId,
		parentId,
		parentLookupValue,
		chargeName: (options.createFields.name as string) ?? '',
		datePurchased: (options.createFields.datePurchased as string) ?? '',
		unitQuantity: options.createFields.unitQuantity as number | undefined,
		unitPrice: options.createFields.unitPrice as number | undefined,
		warnings,
	};
}
```

Key changes: `options.createFields.name` replaces `options.chargeName` everywhere. `resolveBillingCodeId` receives `options.createFields` directly.

- [ ] **Step 7: Remove `getOptionValue()` helper**

Delete lines 329-332 (the `getOptionValue` function). It's no longer used.

- [ ] **Step 8: Build and verify**

Run: `npm run build`
Expected: Build passes (only pre-existing `Autotask.node.ts` errors).

- [ ] **Step 9: Commit**

```bash
git add nodes/Autotask/helpers/charge-creator-base.ts
git commit -m "refactor: simplify charge-creator-base to use createFields record

Replace hardcoded IChargeCreateIfNotExistsOptions with generic
{ createFields, dedupFields, errorOnDuplicate } interface. Remove
fieldNameToApiName and getOptionValue — createFields uses API field
names directly."
```

---

### Task 2: Update `contract-charge-creator.ts` wrapper

**Files:**
- Modify: `nodes/Autotask/helpers/contract-charge-creator.ts`

- [ ] **Step 1: Update config — remove `fieldNameToApiName`, update `fieldTypeMap` keys to API names**

```typescript
const CONTRACT_CHARGE_CONFIG: ChargeCreatorConfig = {
	parentEntityLabel: 'Contract',
	parentQueryEndpoint: 'Contracts/query',
	parentLookupField: 'externalServiceIdentifier',
	chargeQueryEndpoint: 'ContractCharges/query',
	chargeParentIdField: 'contractID',
	chargeCreateEndpointTemplate: 'Contracts/{parentId}/Charges',
	fieldTypeMap: {
		name: 'string',
		datePurchased: 'datetime',
		unitQuantity: 'double',
		unitCost: 'double',
		unitPrice: 'double',
	},
};
```

Key change: `chargeName: 'string'` → `name: 'string'`. `fieldNameToApiName` removed entirely.

- [ ] **Step 2: Simplify interface and wrapper function**

The `IContractChargeCreateIfNotExistsOptions` interface should just extend the base:

```typescript
// Re-export the base interface — contractCharge adds no extra fields
export type IContractChargeCreateIfNotExistsOptions = IChargeCreateIfNotExistsOptions;
```

Update `createContractChargeIfNotExists` to extract `parentLookupValue` from `createFields`:

```typescript
export async function createContractChargeIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IContractChargeCreateIfNotExistsOptions,
): Promise<IContractChargeCreateIfNotExistsResult> {
	const parentLookupValue = options.createFields.externalServiceIdentifier as string;
	if (!parentLookupValue) {
		throw new Error('externalServiceIdentifier is required to find the contract.');
	}

	const result = await createChargeIfNotExists(
		ctx,
		CONTRACT_CHARGE_CONFIG,
		parentLookupValue,
		options,
	);

	return mapToContractChargeResult(result, parentLookupValue);
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add nodes/Autotask/helpers/contract-charge-creator.ts
git commit -m "refactor: update contract-charge-creator for createFields interface"
```

---

### Task 3: Update contractCharges `description.ts` and `execute.ts` (standard node)

**Files:**
- Modify: `nodes/Autotask/resources/contractCharges/description.ts`
- Modify: `nodes/Autotask/resources/contractCharges/execute.ts`

- [ ] **Step 1: Remove hardcoded createIfNotExists fields from description.ts**

Remove the 11 hardcoded field definitions (lines 91-269 — everything between `// ─── createIfNotExists fields` and `// ─── Standard CRUD fields`):
- `externalServiceIdentifier`
- `chargeName`
- `chargeDescription`
- `datePurchased`
- `unitQuantity`
- `unitCost`
- `unitPrice`
- `materialCode`
- `billingCodeID`
- `isBillable`
- `chargeNotes`

**Keep:** `dedupFields` and `errorOnDuplicate` — they are `createIfNotExists`-specific.

- [ ] **Step 2: Add `createIfNotExists` to `fieldsToMap` displayOptions**

In the `fieldsToMap` resourceMapper block (around line 271), change the operation array from:
```typescript
operation: ['create', 'createIfNotExists', 'update', 'getMany', 'count'],
```
Verify it already includes `'createIfNotExists'` (it was added in a previous fix). If not, add it.

- [ ] **Step 3: Update execute.ts — replace individual getNodeParameter calls with resourceMapper read**

Replace the `createIfNotExists` case (lines 97-116) with:

```typescript
case 'createIfNotExists': {
	const { createContractChargeIfNotExists } = await import('../../helpers/contract-charge-creator');
	// Read fields from resourceMapper — same as create operation
	let createFields: Record<string, unknown> = {};
	try {
		const fieldsToMap = this.getNodeParameter('fieldsToMap', i, { value: {} }) as { value: Record<string, unknown> | null };
		createFields = fieldsToMap?.value ?? {};
	} catch { /* fieldsToMap may not be available */ }
	const result = await createContractChargeIfNotExists(this, i, {
		createFields,
		dedupFields: this.getNodeParameter('dedupFields', i, []) as string[],
		errorOnDuplicate: this.getNodeParameter('errorOnDuplicate', i, false) as boolean,
	});
	returnData.push({ json: result as unknown as IDataObject });
	break;
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add nodes/Autotask/resources/contractCharges/description.ts nodes/Autotask/resources/contractCharges/execute.ts
git commit -m "refactor: contractCharges createIfNotExists uses resourceMapper instead of hardcoded fields"
```

---

### Task 4: Update AI tools `schema-generator.ts` for createIfNotExists

**Files:**
- Modify: `nodes/Autotask/ai-tools/schema-generator.ts`

- [ ] **Step 1: Replace hardcoded charge field block with dynamic writeFields reuse**

Find the `createIfNotExists` schema block (starts around line 281 with `const hasCreateIfNotExists = operations.includes('createIfNotExists')`).

Replace the entire charge-specific field block (`isChargeResource` check + hardcoded fields) with logic that reuses the existing `writeFields` loop. The `create`/`update` writeFields loop (lines 171-191) already adds all writable fields. Since `createIfNotExists` is always paired with either `create` or at minimum uses write fields, the fields should already be in `shape` from that loop.

The only thing needed in the `createIfNotExists` block is adding the two operation-specific fields:

```typescript
const hasCreateIfNotExists = operations.includes('createIfNotExists');
if (hasCreateIfNotExists) {
	// Ensure write fields are in schema (reuse create/update loop output)
	// The writeFields loop at lines 171-191 already populates shape with all writable fields
	// when hasCreate is true. If hasCreate is false but hasCreateIfNotExists is true,
	// we need to run the same loop here.
	if (!hasCreate && !hasUpdate) {
		for (const field of writeFields) {
			if (field.id === 'id') continue;
			if (shape[field.id]) continue;
			const desc = buildFieldDescription(field);
			const needsLabelResolution = field.isPickList || field.isReference;
			const base = needsLabelResolution ? rz.union([rz.number(), rz.string()])
				: field.type === 'number' ? rz.number()
				: field.type === 'boolean' ? rz.boolean()
				: rz.string();
			shape[field.id] = base.optional().describe(desc);
		}
	}

	// createIfNotExists-specific fields
	if (!shape.dedupFields) {
		shape.dedupFields = rz.array(rz.string()).optional()
			.describe('Field names for duplicate detection. Use describeFields to discover available field names. Empty = skip dedup, always create.');
	}
	if (!shape.errorOnDuplicate) {
		shape.errorOnDuplicate = rz.boolean().optional()
			.describe('When true, throw an error if a duplicate is found instead of returning a skipped outcome. Default false.');
	}

	// Ensure impersonation fields exist
	if (!shape.impersonationResourceId) {
		shape.impersonationResourceId = rz.union([rz.number(), rz.string()]).optional()
			.describe('Optional resource ID or name to impersonate for write attribution.');
		shape.proceedWithoutImpersonationIfDenied = rz.boolean().optional()
			.describe('When true and impersonation is set, retry without impersonation if denied (default true).');
	}
}
```

**Remove:** All resource-specific field blocks that were inside the old `hasCreateIfNotExists` block:
- The `isChargeResource` block with hardcoded chargeName, chargeDescription, etc.
- The `contractCharge`-specific `externalServiceIdentifier` field
- The `ticketCharge`-specific `ticketID` field
- The `projectCharge`-specific `projectID` field
- The `contractService`-specific fields
- The `contract`-specific fields
- The `configurationItems`-specific fields
- The `timeEntry`-specific fields

All these fields now come from the dynamic writeFields loop.

- [ ] **Step 2: Build and verify**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add nodes/Autotask/ai-tools/schema-generator.ts
git commit -m "refactor: createIfNotExists schema uses dynamic writeFields instead of hardcoded fields"
```

---

### Task 5: Update AI tools `tool-executor.ts` — simplify short-circuit block

**Files:**
- Modify: `nodes/Autotask/ai-tools/tool-executor.ts`

- [ ] **Step 1: Add `dedupFields` and `errorOnDuplicate` to `buildFieldValues` exclude set**

Find `buildFieldValues()` (around line 287). Add `'dedupFields'` and `'errorOnDuplicate'` to the `exclude` set so they don't leak into `fieldValues` / `createFields` and eventually into the API body:

```typescript
const exclude = new Set([
    ...excludeKeys,
    'resource',
    'operation',
    'dedupFields',           // createIfNotExists-specific, not an API field
    'errorOnDuplicate',      // createIfNotExists-specific, not an API field
    'filter_field',
    // ... rest unchanged
```

**Why this is critical:** Without this, `dedupFields` and `errorOnDuplicate` will:
1. Fail `validateWriteFields()` (they aren't entity fields)
2. Leak into the API POST body if they somehow pass validation

- [ ] **Step 2: Add `createIfNotExists` to the validation and label resolution blocks**

Find the validation block (around line 567):
```typescript
if (['create', 'update'].includes(effectiveOperation)) {
```
Change to:
```typescript
if (['create', 'createIfNotExists', 'update'].includes(effectiveOperation)) {
```

Find the label resolution block (around line 579):
```typescript
if (['create', 'update'].includes(effectiveOperation) && Object.keys(fieldValues).length > 0) {
```
Change to:
```typescript
if (['create', 'createIfNotExists', 'update'].includes(effectiveOperation) && Object.keys(fieldValues).length > 0) {
```

This means `buildFieldValues()`, `validateWriteFields()`, and `resolveLabelsToIds()` now run for `createIfNotExists` just like for `create`/`update`.

- [ ] **Step 3: Simplify the `createIfNotExists` short-circuit block**

Replace the entire per-entity if/else-if chain (currently ~lines 779-920) with a unified block that builds `createFields` from the already-processed `fieldValues`, then dispatches to the correct helper:

```typescript
if (effectiveOperation === 'createIfNotExists') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let compoundResult: any;

	// createFields comes from fieldValues (already validated + label-resolved above)
	const createFields: Record<string, unknown> = { ...fieldValues };
	const dedupFields = (params.dedupFields as string[]) ?? ['name', 'datePurchased'];
	const errorOnDuplicate = params.errorOnDuplicate === true;

	const compoundOptions = {
		createFields,
		dedupFields,
		errorOnDuplicate,
		impersonationResourceId: resolvedImpersonationId,
		proceedWithoutImpersonationIfDenied: params.proceedWithoutImpersonationIfDenied !== false,
	};

	if (resource === 'contractCharge') {
		const { createContractChargeIfNotExists } = await import('../helpers/contract-charge-creator');
		compoundResult = await createContractChargeIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'ticketCharge') {
		const { createTicketChargeIfNotExists } = await import('../helpers/ticket-charge-creator');
		compoundResult = await createTicketChargeIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'projectCharge') {
		const { createProjectChargeIfNotExists } = await import('../helpers/project-charge-creator');
		compoundResult = await createProjectChargeIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'configurationItems') {
		const { createConfigurationItemIfNotExists } = await import('../helpers/configuration-item-creator');
		compoundResult = await createConfigurationItemIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'timeEntry') {
		const { createTimeEntryIfNotExists } = await import('../helpers/time-entry-creator');
		compoundResult = await createTimeEntryIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'contractService') {
		const { createContractServiceIfNotExists } = await import('../helpers/contract-service-creator');
		compoundResult = await createContractServiceIfNotExists(context, 0, compoundOptions);
	} else if (resource === 'contract') {
		const { createContractIfNotExists } = await import('../helpers/contract-creator');
		compoundResult = await createContractIfNotExists(context, 0, compoundOptions);
	}

	if (compoundResult) {
		return JSON.stringify(wrapSuccess(resource, `${resource}.createIfNotExists`, compoundResult));
	}
}
```

Key changes:
- `fieldValues` (already processed by `buildFieldValues` + `validateWriteFields` + `resolveLabelsToIds`) becomes `createFields`
- No per-entity field extraction — all entities get the same `compoundOptions`
- Removes ~140 lines of per-entity `params.fieldName as type` extraction

- [ ] **Step 4: Build and verify**

Run: `npm run build`

Note: Non-charge helper imports are dynamic (lazy `import()`), so they won't cause compile-time errors even though their interfaces haven't been updated yet.

- [ ] **Step 6: Commit**

```bash
git add nodes/Autotask/ai-tools/tool-executor.ts
git commit -m "refactor: unify createIfNotExists short-circuit to use fieldValues + createFields pattern"
```

---

### Task 6: Simplify AI tools `description-builders.ts`

**Files:**
- Modify: `nodes/Autotask/ai-tools/description-builders.ts`

- [ ] **Step 1: Replace per-entity createIfNotExists description functions**

Find all `buildXxxCreateIfNotExistsDescription` functions (there should be 7). Replace them all with a single generic function:

```typescript
function buildCreateIfNotExistsDescription(resource: string): string {
	return `Idempotent creation for ${resource}. Checks for duplicates using configurable dedupFields before creating. ` +
		`Pass the same fields as the create operation, plus dedupFields (array of API field names for duplicate detection) ` +
		`and errorOnDuplicate (boolean, default false). Use describeFields first to discover available field names. ` +
		`Returns outcome: created, skipped, or not_found.`;
}
```

- [ ] **Step 2: Update the switch case in `buildUnifiedDescription`**

Find the `case 'createIfNotExists':` block and replace with:

```typescript
case 'createIfNotExists':
	summary = buildCreateIfNotExistsDescription(resource);
	break;
```

- [ ] **Step 3: Remove the 7 old per-entity description functions**

Delete: `buildContractChargeCreateIfNotExistsDescription`, `buildTicketChargeCreateIfNotExistsDescription`, `buildProjectChargeCreateIfNotExistsDescription`, `buildConfigurationItemCreateIfNotExistsDescription`, `buildTimeEntryCreateIfNotExistsDescription`, `buildContractServiceCreateIfNotExistsDescription`, `buildContractCreateIfNotExistsDescription`.

- [ ] **Step 4: Build and verify**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add nodes/Autotask/ai-tools/description-builders.ts
git commit -m "refactor: replace 7 per-entity createIfNotExists descriptions with single generic function"
```

---

### Task 7: Update remaining charge entity wrappers (ticketCharge, projectCharge)

**Files:**
- Modify: `nodes/Autotask/helpers/ticket-charge-creator.ts`
- Modify: `nodes/Autotask/helpers/project-charge-creator.ts`
- Modify: `nodes/Autotask/resources/ticketCharges/description.ts`
- Modify: `nodes/Autotask/resources/ticketCharges/execute.ts`
- Modify: `nodes/Autotask/resources/projectCharges/description.ts`
- Modify: `nodes/Autotask/resources/projectCharges/execute.ts`

Follow the exact same pattern as Tasks 2-3 for contractCharge:

- [ ] **Step 1: Update `ticket-charge-creator.ts`**

Same changes as Task 2:
- Update `fieldTypeMap` keys to API names (e.g., `name` not `chargeName`)
- Remove `fieldNameToApiName`
- Export type alias: `export type ITicketChargeCreateIfNotExistsOptions = IChargeCreateIfNotExistsOptions;`
- Extract parent lookup value from `createFields.ticketID` (for numeric) or `createFields.ticketNumber` (for string) — the dual-config lookup pattern stays, but it reads from `createFields` instead of named options

- [ ] **Step 2: Update `project-charge-creator.ts`**

Same pattern — extract `createFields.projectID` or `createFields.projectNumber` for parent lookup.

- [ ] **Step 3: Update ticketCharges description.ts**

Remove hardcoded createIfNotExists fields (ticketID, chargeName, chargeDescription, datePurchased, unitQuantity, unitCost, unitPrice, materialCode, billingCodeID, isBillable, chargeNotes). Keep dedupFields + errorOnDuplicate. Ensure `createIfNotExists` is in fieldsToMap displayOptions.

- [ ] **Step 4: Update ticketCharges execute.ts**

Replace individual `getNodeParameter()` calls with resourceMapper read (same pattern as Task 3 Step 3).

- [ ] **Step 5: Update projectCharges description.ts and execute.ts**

Same pattern.

- [ ] **Step 6: Build and verify**

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add nodes/Autotask/helpers/ticket-charge-creator.ts nodes/Autotask/helpers/project-charge-creator.ts \
  nodes/Autotask/resources/ticketCharges/description.ts nodes/Autotask/resources/ticketCharges/execute.ts \
  nodes/Autotask/resources/projectCharges/description.ts nodes/Autotask/resources/projectCharges/execute.ts
git commit -m "refactor: ticketCharge and projectCharge createIfNotExists use resourceMapper + createFields"
```

---

### Task 8: Update non-charge entity helpers (configurationItems, timeEntry, contractService, contract)

**Files:**
- Modify: `nodes/Autotask/helpers/configuration-item-creator.ts`
- Modify: `nodes/Autotask/helpers/time-entry-creator.ts`
- Modify: `nodes/Autotask/helpers/contract-service-creator.ts`
- Modify: `nodes/Autotask/helpers/contract-creator.ts`

These helpers already receive `createFields` from tool-executor.ts for the AI path. The change is to simplify their interfaces to match the new standard.

- [ ] **Step 1: Update `configuration-item-creator.ts`**

Replace `IConfigurationItemCreateIfNotExistsOptions` with:
```typescript
export interface IConfigurationItemCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
}
```

Update internal functions to extract `companyID` from `createFields.companyID`. Update `fieldTypeMap` keys to API field names. Update dedup comparison to use `createFields[field]` directly.

- [ ] **Step 2: Update `time-entry-creator.ts`**

Same pattern — extract `resourceID`, `ticketID`, `taskID` from `createFields`. Update `fieldTypeMap` keys.

- [ ] **Step 3: Update `contract-service-creator.ts`**

Same pattern — extract `contractID` from `createFields`. Update dedup comparison.

- [ ] **Step 4: Update `contract-creator.ts`**

Same pattern — extract `companyID` from `createFields`. Update dedup comparison.

- [ ] **Step 5: Build and verify**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add nodes/Autotask/helpers/configuration-item-creator.ts nodes/Autotask/helpers/time-entry-creator.ts \
  nodes/Autotask/helpers/contract-service-creator.ts nodes/Autotask/helpers/contract-creator.ts
git commit -m "refactor: non-charge helpers use createFields interface"
```

---

### Task 9: Update non-charge entity description.ts and execute.ts files

**Files:**
- Modify: `nodes/Autotask/resources/configurationItems/description.ts` and `execute.ts`
- Modify: `nodes/Autotask/resources/timeEntries/description.ts` and `execute.ts`
- Modify: `nodes/Autotask/resources/contractServices/description.ts` and `execute.ts`
- Modify: `nodes/Autotask/resources/contracts/description.ts` and `execute.ts`

- [ ] **Step 1: Update configurationItems description.ts**

Remove hardcoded createIfNotExists fields (companyID + any entity-specific fields). Keep dedupFields + errorOnDuplicate. Ensure `createIfNotExists` in fieldsToMap displayOptions.

- [ ] **Step 2: Update configurationItems execute.ts**

Replace individual `getNodeParameter()` calls with resourceMapper read.

- [ ] **Step 3: Update timeEntries description.ts and execute.ts**

Same pattern.

- [ ] **Step 4: Update contractServices description.ts and execute.ts**

Same pattern.

- [ ] **Step 5: Update contracts description.ts and execute.ts**

Same pattern.

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Build passes clean (only pre-existing errors).

- [ ] **Step 7: Commit**

```bash
git add nodes/Autotask/resources/configurationItems/ nodes/Autotask/resources/timeEntries/ \
  nodes/Autotask/resources/contractServices/ nodes/Autotask/resources/contracts/
git commit -m "refactor: non-charge entity createIfNotExists uses resourceMapper + createFields"
```

---

### Task 10: Update CLAUDE.md and CHANGELOG.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Compound operations" section, update the description to note that `createIfNotExists` uses the same `createFields: Record<string, unknown>` interface across all entities, with keys being API field names. Note that `fieldNameToApiName` was removed from `ChargeCreatorConfig`.

- [ ] **Step 2: Update CHANGELOG.md**

Add entries under `[2.6.0]` or create `[2.6.1]` (whichever is appropriate):

```markdown
### Changed
- `createIfNotExists` now uses the same dynamic resourceMapper/entity-metadata for fields as the `create` operation — no more hardcoded field definitions
- Simplified `IChargeCreateIfNotExistsOptions` to `{ createFields, dedupFields, errorOnDuplicate }` — all entity fields come from the resource mapper
- AI tools `createIfNotExists` schema now uses dynamic writeFields loop (same as create/update) instead of hardcoded Zod fields
- AI tools `createIfNotExists` now benefits from field validation (`validateWriteFields`) and label resolution (`resolveLabelsToIds`)
- Removed `fieldNameToApiName` from `ChargeCreatorConfig` — `createFields` uses API field names directly
- Replaced 7 per-entity AI description functions with single generic `buildCreateIfNotExistsDescription`
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: update CLAUDE.md and CHANGELOG for createIfNotExists alignment refactor"
```
