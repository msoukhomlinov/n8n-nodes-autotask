# Design: Align `createIfNotExists` with `create` Operation Pattern

**Date:** 2026-03-19
**Status:** Approved (rev 2 — post spec review)
**Scope:** contractCharge first, then all 6 other entities

## Problem

`createIfNotExists` hardcodes 11-13 entity field definitions in three places (description.ts, execute.ts, schema-generator.ts), while `create` uses a dynamic resourceMapper / entity-metadata approach. This means:

- New API fields require code changes to `createIfNotExists` but not `create`
- Label resolution (name-to-ID) is skipped for `createIfNotExists`
- Field validation against entity schema is skipped
- Maintenance burden multiplied across 7 entities

## Design Principle

`createIfNotExists` = `create` (resourceMapper for entity fields) + `dedupFields` + `errorOnDuplicate`. No hardcoded entity fields anywhere.

## Critical Design Decision: `createFields` uses API field names

Since `createFields` comes from the resourceMapper (which uses entity metadata from the Autotask API), the keys are **API field names**, not user-facing aliases. For example:

| User-facing (old) | API field name (new) |
|-------------------|---------------------|
| `chargeName` | `name` |
| `isBillable` | `isBillableToCompany` |
| `chargeDescription` | `description` |
| `chargeNotes` | `internalNotes` |

This means:
- **`fieldNameToApiName`** mapping in `ChargeCreatorConfig` is **removed** — no longer needed
- **`fieldTypeMap`** keys must use **API field names** (e.g., `name` not `chargeName`)
- **`dedupFields`** values selected by users are **API field names** (which `getSelectColumns` already returns)
- Dedup comparison uses `createFields[apiFieldName]` directly — no name remapping

## Architecture

### Standard Node

#### description.ts

**Remove:** All hardcoded entity field definitions for `createIfNotExists` (e.g., externalServiceIdentifier, chargeName, chargeDescription, datePurchased, unitQuantity, unitCost, unitPrice, materialCode, billingCodeID, isBillable, chargeNotes for contractCharge).

**Keep:** `dedupFields` (multiOptions with `loadOptionsMethod: 'getSelectColumns'`) and `errorOnDuplicate` (boolean). These are the only `createIfNotExists`-specific fields.

**Change:** Add `'createIfNotExists'` to the existing `fieldsToMap` resourceMapper's `displayOptions.show.operation` array. The user sees the same dynamic field mapper as `create`, plus the two dedup controls.

The parent lookup field (e.g., `externalServiceIdentifier` for contractCharge, `ticketID` for ticketCharge) is provided by the user inside the resourceMapper, not as a separate top-level parameter. The helper extracts it from `createFields`.

#### execute.ts

**Remove:** Individual `getNodeParameter()` calls for each entity field.

**Replace with:**
1. Read `fieldsToMap` via resourceMapper — extract field values into `Record<string, unknown>` using the same approach as `CreateOperation` (call `this.getNodeParameter('fieldsToMap', i)` and extract `.value`)
2. Read `dedupFields` and `errorOnDuplicate` separately
3. Pass `{ createFields, dedupFields, errorOnDuplicate }` to the helper

**Note:** The standard node path does NOT replicate `CreateOperation`'s full pipeline (label resolution, date conversion). These responsibilities are handled by the Autotask API itself (dates) and are not needed for the standard node path since the resourceMapper already provides properly-typed values. The helper receives raw field values from the mapper.

### Helper Layer

#### charge-creator-base.ts

**Simplified interface:**

```typescript
interface IChargeCreateIfNotExistsOptions {
  createFields: Record<string, unknown>;
  dedupFields: string[];
  errorOnDuplicate: boolean;
  impersonationResourceId?: number;
  proceedWithoutImpersonationIfDenied?: boolean;
}
```

**Function-level changes:**

**`findDuplicateCharge()`** — Currently references `options.chargeName` for the API filter optimization and uses `fieldNameToApiName` for dedup comparison. Changes:
- API filter optimization: `if (dedupFields.includes('name')) { apiFilter.push({ field: 'name', op: 'eq', value: createFields['name'] }); }`
- Dedup comparison: `const inputValue = createFields[field];` and `const apiValue = charge[field];` (direct lookup on both sides — no `getOptionValue()` or `fieldNameToApiName` remapping needed, since `dedupFields`, `createFields`, and API responses all use API field names)

**`resolveBillingCodeId()`** — Currently accesses `options.billingCodeID` and `options.materialCode`. Changes:
- Signature: accepts `createFields: Record<string, unknown>` instead of `IChargeCreateIfNotExistsOptions`
- Access: `createFields.billingCodeID` and `createFields.materialCode`
- Billing code resolution is now optional — if neither field is in `createFields`, the helper skips resolution entirely (the `create` operation doesn't require it, so `createIfNotExists` shouldn't either when the user doesn't provide either field). If `billingCodeID` is already in `createFields`, it's used directly. If only `materialCode` is present, resolution runs. If the API requires `billingCodeID` and neither is provided, the API itself will reject the creation with a clear error — no need for a pre-flight check in the helper.

**`createCharge()`** — Currently builds the API body by hand-mapping named fields. Changes:
- The API body is built from `createFields` directly: `const body: IDataObject = { ...createFields, [config.chargeParentIdField]: parentId }`
- If `resolveBillingCodeId` resolved a value, it overrides `createFields.billingCodeID`
- Remove all hand-mapped field assignments (`name: options.chargeName`, `isBillableToCompany: options.isBillable`, etc.) — since `createFields` already uses API field names, no remapping needed
- Strip `materialCode` from body before API call (it's not a real API field)

**`createChargeIfNotExists()` return value** — `IChargeCreateResult` currently references `options.chargeName`, `options.datePurchased`, etc. Changes:
- Source from `createFields`: `chargeName: createFields.name as string`, `datePurchased: createFields.datePurchased as string`
- Or simplify: include `createFields` in the result and let callers extract what they need

**`getOptionValue()`** — **Removed entirely**. Direct `createFields[fieldName]` replaces it.

**`fieldNameToApiName`** — **Removed from `ChargeCreatorConfig`**. No longer needed since `createFields` keys are API field names.

**`fieldTypeMap`** — Keys updated to use **API field names**:
```typescript
// Before:
fieldTypeMap: { chargeName: 'string', datePurchased: 'datetime', unitQuantity: 'double', ... }
// After:
fieldTypeMap: { name: 'string', datePurchased: 'datetime', unitQuantity: 'double', ... }
```

#### Non-charge helpers

Same simplified interface:

```typescript
interface I<Entity>CreateIfNotExistsOptions {
  createFields: Record<string, unknown>;
  dedupFields: string[];
  errorOnDuplicate: boolean;
  impersonationResourceId?: number;
  proceedWithoutImpersonationIfDenied?: boolean;
}
```

Each helper extracts its scope/parent fields from `createFields` using API field names.

**Note:** configurationItems, timeEntry, contractService, and contract already use a `createFields` extraction pattern in tool-executor.ts. These only need interface alignment in their helpers. The 3 charge entities require the full refactor.

### AI Tools Node

#### schema-generator.ts

**Remove:** Hardcoded entity field blocks for `createIfNotExists`.

**Replace with:** Use the same dynamic `writeFields` loop as `create`/`update`. For each writable field from entity metadata:
- Picklist/reference fields get `rz.union([rz.number(), rz.string()])` (enables label resolution)
- Other fields get their standard Zod type

Add `dedupFields` (`rz.array(rz.string()).optional().describe(...)`) and `errorOnDuplicate` (`rz.boolean().optional()`) to the schema. These are the only `createIfNotExists`-specific additions.

No per-entity field blocks needed. The dynamic loop handles all entities uniformly.

#### Required field validation (AI tools path)

The compound operation short-circuit block in tool-executor.ts currently bypasses `validateWriteFields()`. With the new design:
- Call `validateWriteFields(createFields, writeFields)` on the extracted `createFields` before passing to the helper
- This checks field name existence and required-field presence, matching what `create`/`update` do
- If validation fails, return a `wrapError(VALIDATION_ERROR)` before reaching the helper

#### Label resolution (AI tools path)

Call `resolveLabelsToIds()` on `createFields` before passing to the helper:
- Picklist fields: resolve human-readable labels to IDs
- Reference fields: resolve names to numeric IDs
- This matches what `create`/`update` already do

The resolved `createFields` then goes to the helper with all IDs properly resolved.

#### description-builders.ts

Simplify per-entity description functions. The operation description mentions:
- That it finds or creates the entity
- That `dedupFields` controls duplicate detection
- That field values come from the same fields as `create`

No need to enumerate fields in the description since they come from entity metadata.

#### tool-executor.ts

**Simplify the short-circuit block:**
1. Build `createFields` from params (filter out reserved keys: `operation`, `resource`, `dedupFields`, `errorOnDuplicate`, `impersonationResourceId`, `proceedWithoutImpersonationIfDenied`)
2. Call `validateWriteFields(createFields, writeFields)` for field validation
3. Call `resolveLabelsToIds()` on `createFields` for label resolution
4. Extract `dedupFields` and `errorOnDuplicate` from params
5. Pass `{ createFields, dedupFields, errorOnDuplicate, impersonationResourceId, proceedWithoutImpersonationIfDenied }` to the helper

This is the same pattern for ALL 7 entities. No per-entity field extraction needed (only the helper import differs per entity).

**Default `dedupFields` fallback values** in tool-executor.ts must be updated to use API field names:
- Charge entities: `['chargeName', 'datePurchased']` → `['name', 'datePurchased']`
- configurationItems: `['serialNumber']` (already API name — no change)
- timeEntry: `['dateWorked', 'hoursWorked']` (already API names — no change)
- contractService: `['serviceID']` (already API name — no change)
- contract: `['contractName']` (already API name — no change)

**Backward compatibility:** `getSelectColumns` returns `value: field.id` (line 764 of `Autotask.node.ts`), which is the API field name. Users who have already configured `dedupFields` via the multiOptions dropdown are already using API field names. No migration needed.

## What Changes vs What Stays

### Removed
- `fieldNameToApiName` from `ChargeCreatorConfig`
- `getOptionValue()` helper function
- All hardcoded field definitions in description.ts (11-13 per entity)
- All individual `getNodeParameter()` calls in execute.ts
- All hardcoded Zod field blocks in schema-generator.ts

### Changed
- `IChargeCreateIfNotExistsOptions` → `{ createFields, dedupFields, errorOnDuplicate }`
- `fieldTypeMap` keys → API field names
- `findDuplicateCharge()` → uses `createFields[field]` directly
- `resolveBillingCodeId()` → accepts `createFields` record
- `createCharge()` → spreads `createFields` as API body
- `IChargeCreateResult` → sources display values from `createFields`

### Stays the Same
- 4-step orchestration flow (find parent, dedup, resolve billing, create)
- `ChargeCreatorConfig` structure (minus `fieldNameToApiName`)
- `dedup-utils.ts` (`compareDedupField`, normalisation helpers)
- `findParentEntity()` function
- Non-charge helper orchestration logic

## Entity-Specific Notes

| Entity | Parent Lookup Field (extracted from createFields) | Special Handling |
|--------|--------------------------------------------------|-----------------|
| contractCharge | `externalServiceIdentifier` (queries Contracts) | `materialCode` -> `billingCodeID` resolution, strip `materialCode` from API body |
| ticketCharge | `ticketID` (numeric ID or ticketNumber string) | Same billing code resolution |
| projectCharge | `projectID` (numeric ID or projectNumber string) | Same billing code resolution |
| configurationItems | `companyID` (scope field, not parent chain) | Company existence verification |
| timeEntry | `resourceID` + optional `ticketID`/`taskID` | Multi-field scope |
| contractService | `contractID` (numeric or externalServiceIdentifier) | `serviceID` in scope |
| contract | `companyID` (scope field) | Company existence verification |

## Implementation Order

1. **contractCharge** (template — full refactor of charge-creator-base + description + execute + schema + executor)
2. **ticketCharge + projectCharge** (same charge pattern, reuse refactored base)
3. **configurationItems, timeEntry, contractService, contract** (interface alignment only — these already use `createFields` in tool-executor.ts)

## Files Changed Per Entity

| File | Change |
|------|--------|
| `resources/<entity>/description.ts` | Remove hardcoded fields, ensure `createIfNotExists` in fieldsToMap displayOptions |
| `resources/<entity>/execute.ts` | Replace individual getNodeParameter calls with resourceMapper read |
| `helpers/<entity>-creator.ts` | Simplify interface to `{ createFields, dedupFields, errorOnDuplicate }` |
| `helpers/charge-creator-base.ts` | Simplify interface, remove `getOptionValue`/`fieldNameToApiName`, use `createFields` throughout |
| `ai-tools/schema-generator.ts` | Remove hardcoded field blocks, use dynamic writeFields loop for createIfNotExists |
| `ai-tools/description-builders.ts` | Simplify per-entity descriptions |
| `ai-tools/tool-executor.ts` | Simplify short-circuit block to generic createFields extraction + validation + label resolution |
