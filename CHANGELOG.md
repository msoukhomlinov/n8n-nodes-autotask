# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

## [2.10.0] — 2026-04-19

### Added

- **AI tools — automatic ID enrichment of response records**: Records returned by AI tool operations are now automatically enriched with human-readable fields when they contain `ticketID` or `taskID`. Records with `ticketID` gain `ticketNumber` and `ticketTitle`; records with `taskID` gain `taskTitle`, `taskProjectNumber`, and `taskProjectName`. Enrichment applies to all `records[]` and `record{}` response shapes including compound (`createIfNotExists`) results. Single insertion point in `tool-executor.ts`: `enrichResponseJson()` is called between `dispatchOperationResponse` and `attachCorrelation` on the main happy-path, and between `buildCompoundResponse` and `attachCorrelation` on the compound path. Failure-safe — outer try/catch returns the original JSON on any panic.
- **Module-level in-memory enrichment cache** (1800 s TTL) with in-flight request coalescing via `Map<string, Promise<...>>` — no CacheService dependency. Shared across all tool invocations in the same process.
- **`EntityValueHelper.getValuesByIds()` optional `includeFields` parameter**: Callers can now pass a list of field names to restrict which fields the Autotask API returns, reducing response payload size. Used by the enrichment engine to fetch only the required fields per entity type.

> ⚠️ **Behavioural note:** List and single-record operation responses will now include additional fields (`ticketNumber`, `ticketTitle`, `taskTitle`, `taskProjectNumber`, `taskProjectName`) when records reference tickets or tasks. LLM prompts or downstream automations that depend on the **absence** of these fields should be reviewed.

### Changed

- **AI tools — typed-reference auto-resolution for ticket and project references**: Any reference field whose `referencesEntity` is `ticket` or `project` now auto-resolves human-readable identifiers on both write and filter paths. Ticket numbers matching `T{YYYYMMDD}.{seq4}` (e.g. `T20240615.0674`) resolve via a single `Tickets/query { ticketNumber eq }` lookup. Project numbers resolve via `Projects/query { projectNumber eq }`. When a human-readable string doesn't match the number format, an optional companion field (`ticketLookupField: 'title' | 'description'` or `projectLookupField: 'projectName' | 'description'`) switches the lookup to a `contains` search on the chosen field. Eliminates the previous fall-through to `EntityValueHelper`, which fetched the full entity list and rarely matched on non-numeric label fields. Registry-driven via `helpers/typed-reference/` — adding Contract, Company, etc. in future releases is a one-entry change.
- **`ticket.summary` operation now correctly resolves ticketNumber via `IDENTIFIER_PAIR_OPERATIONS`**: Previously, only `slaHealthCheck` received the registry-driven identifier routing; `summary` was silently falling through to id-only mode. The routing in `resources/tool/execute.ts` is now fully registry-driven.
- **Identifier-pair field descriptions now explicit about omission**: Schema descriptions for `id`, `ticketNumber`, and `operation` enum now instruct the LLM to OMIT the unused field entirely instead of sending `null`. This reduces incorrect dual-identifier inputs at the LLM level.
- **AI tools — token-efficient tool descriptions**: Six micro-optimisations reduce MCP context consumption for multi-resource `AutotaskAiTools` configurations from ~14k–21k tokens down to ~7k–13k. No schema-shape changes — Zod contract unchanged; only `.describe()` text and picklist-inlining thresholds change.
  - **Typed-reference hints compressed** (`schema-generator.ts` `buildFieldDescription`): hints shortened from ~180 chars to ~95 chars. Branches on `strategy.numberPattern`: `ticket` → `ticketNumber e.g. T20240615.0674`; `project` → `project number e.g. P20240615.0010`. Plain references: `(ref→X: ID or name)`.
  - **`filter_field_2` enum deduplication** (`schema-generator.ts`): `filter_field_2` is now a plain nullish string rather than a duplicate of the full readable-field enum. Runtime unchanged — `filter-builder.ts` falls through on unknown field names.
  - **Description boilerplate extracted** (`description-builders.ts`): `ASCENDING_ID_WARNING` constant; `describeFieldsHint(resourceName, mode)` template function; `RECENCY_VS_SINCE_UNTIL_RULE` added to `LIST_ADVANCED_NOTES`.
  - **Impersonation descriptions unified** (`schema-generator.ts`): `IMPERSONATION_RESOURCE_ID_DESCRIBE` and `IMPERSONATION_PROCEED_DESCRIBE` constants replace 5 near-duplicate `.describe()` calls.
  - **Identifier-pair disambiguation consolidated** (`schema-generator.ts`): "supply EITHER id OR altIdField" note removed from `operation` description; shortened to `Omit if using '<altIdField>'` on the `id` field; full rule kept on `altIdField`. Runtime enforcement via `operation-contracts.ts` xorGroups unchanged.
  - **Picklist inlining threshold lowered** (`schema-generator.ts` + `description-builders.ts`): 3-tier model collapsed to 2-tier (≤4 full inline / >4 count + `listPicklistValues` hint). `MAX_INLINE_PICKLIST_VALUES = 8` → `INLINE_PICKLIST_THRESHOLD = 4`; `LARGE_PICKLIST_THRESHOLD` removed; `MAX_INLINE_REQUIRED_PICKLIST` 10 → 4.
- **Description compression round 2.** Trimmed `.describe()` strings across `schema-generator.ts` (always-emitted fields, list-family fields, write-family fields, dynamic per-field suffixes, and ticket.summary flags) and compressed the unified description template in `description-builders.ts` (WRITE SAFETY header, `describeOperation` helper line, `dateTimeReferenceSnippet`, ops-enum lead-in, `describeFields`/`listPicklistValues` helper lines, `createIfNotExists` summary, and `getMany` date-field hint). Deduplicated three per-op "name-based resolution" clauses into one global trailing line. No schema shape changes; all load-bearing clauses (required fields, `(default true)`, `Ignored when errorOnDuplicate is true`, `e.g. T20240615.0674`, 500-record ceiling, `never both`/`do not send id=null`, IFilterCondition JSON example) preserved. Estimated ~27–30% additional token reduction on top of the v2.10.0 baseline; ticket resource now fits under the 2000-char unified-description cap without truncation.

### Fixed

- **Companion fields (`ticketLookupField`, `projectLookupField`) never leak to API request bodies**: Excluded from `buildFieldValues` in `tool-executor.ts` and stripped defensively after `resolveLabelsToIds` returns. They are schema-only inputs consumed by the resolver.
- **AI tools — `.optional()` fields now use `.nullish()` for LLM null safety**: LLM models like Qwen emit JSON `null` for unused optional fields instead of omitting them. Pre-v2.10.0, schema fields were declared `rz.number().optional()` which accepts `undefined` but rejects `null`, causing false-negative Zod parse failures. All 101 optional schema fields now use `.nullish()` (which accepts both `null` and `undefined`). This resolves identifier-pair operations (`ticket.summary`, `ticket.slaHealthCheck`) and mutation operations failing silently with non-frontier LLMs.
- **Agent V3 `execute()` path — pre-normalisation + contract error surfacing**: When Zod schema parse fails in the `execute()` path, operation-contract violations (required fields, xor groups, forbidden fields) are now validated and surfaced with human-readable error messages, replacing opaque Zod type errors. Pre-parse normalisation (metadata stripping + `null→undefined` coercion) ensures consistent parse input across both `execute()` and `supplyData()→func()` paths.
- **AI tools — null fields now treated as omitted (not as explicit null updates)**: Downstream handlers (`buildFieldValues()` on write ops, `coerceFilterValueByFieldType()` on filters) did not treat null as "field omitted" after schema change to `.nullish()`. This caused write operations to send explicit `null` values to the API (unintended field clears) and filter operations to crash on null. Fix: Entry-point normalisation in `executeAiTool()` now deletes null-valued params before processing; `buildFieldValues()` explicitly filters `value !== null`. Both P1 (filter safety) and P2 (write field data integrity) issues identified by Codex review are resolved.

## [2.9.1] — 2026-04-17

### Fixed

- **AI tools — false-negative on all `create` operations**: `extractId` in `operation-dispatch.ts` only inspected `record.itemId ?? record.id` at the top level, but `autotaskApiRequest` wraps POST/PUT/PATCH responses as `{ item: { id: N } }` (helpers/http/request.ts). All `create` operations across all resources (`contact`, `ticket`, `company`, `project`, etc.) returned `"Create <resource> did not return a created entity ID."` despite the entity being successfully created in Autotask. `update` and `reject` masked the same bug via a `params.id` fallback but produced a wrong `response.record` shape (`{ item: { id: N } }` leaked into the mutation envelope). Fix: `extractId` now checks the wrapped `record.item.{id,itemId}` shape first and falls back to top-level. The mutation branch also unwraps `firstRecord` before `buildMutationResponse` so `response.record` contains entity fields directly. Standard node response shape is unchanged.

## [Unreleased]

### Fixed

- **tool/execute**: Removed stale `dryRun` suggestion from write-blocked safety gate error message — AI agents cannot use `dryRun` (removed from schema in v2.9.0, stripped via `N8N_METADATA_FIELDS`), so the hint caused an unactionable retry loop.
- **schema-generator**: Removed `.superRefine()` from top-level Zod schema — restores `ZodObject` shape required by n8n's `normalizeToolSchema` `instanceof` check. `superRefine` produced `ZodEffects` which silently corrupted the schema for MCP Trigger and Agent V3 execution paths. The `readOnlySchemaCache` no longer caches a corrupted type.
- **operation-contracts**: `hasProvidedValue` now rejects non-positive numbers (`id: 0`, `id: -1`), restoring the `id > 0` guard from the old identifier-pair pre-flight.
- **operation-contracts**: `getXorMessage` no longer hardcodes "numeric Ticket ID" — derives the entity label dynamically from the resource name.
- **operation-contracts**: Added module-load self-consistency assertion — throws on startup if any contract has a field in both `requiredFields` and `forbiddenFields`, or an `xorGroup` with fewer than 2 members.
- **tool-executor**: Filter cross-validation (filtersJson/flat conflicts, filter pair integrity, recency/since/until conflicts) migrated from the removed `superRefine` block — enforced on both MCP and Agent V3 execution paths.
- **tool-executor**: `reject` + `rejectReasonPolicy=mandatory` pre-flight now runs correctly (was unreachable dead code inside `superRefine`'s list-operation early-return guard).
- **tool-executor**: Contract violation `nextAction` messages now include specific violation details instead of the generic "provide arguments that satisfy the operation contract" phrase.

## [Unreleased]

### Changed

- **Breaking: AI tool response envelope redesign (v3)**. All AI tool responses now use a flat JSON shape with `summary` always at root. Old nested `{ result: { kind, data, flags } }` shape is removed.
  - Success responses: top-level key determines shape (`records[]`, `record{}`, `id`+`record{}`, `matchCount`, `outcome`, `dryRun`, `fields[]`, `picklistValues[]`, `operationDoc{}`, `ticketSummary{}`). No `kind` discriminator.
  - Error responses: `error: true`, `errorType`, `summary`, `nextAction`, context fields (`filtersUsed`, `missingFields`, etc.) lifted to root — no nesting under `context`.
  - `summary` always present — plain English, termination signals for lists baked in.
  - `appliedResolutions` renamed to `resolvedLabels`; `method` field dropped.
  - `flags` removed. `dryRunOnly` flag replaced by top-level `dryRun: true`.
  - `schemaVersion`, `result` wrapper, `kind` discriminator removed.
  - `returnedCount` (list) and `matchCount` (count) replace ambiguous `count`.
- `operation-dispatch.ts`: all operation cases rewritten to use new flat builders.
- `tool-executor.ts`: helper operations (describeFields, listPicklistValues, describeOperation), dry-run block, and compound block updated to use flat builders.
- `write-guard.ts`: `buildWriteResolutionBlocker` now produces flat error with named root fields.
- `debug-trace.ts`: `summariseResponseEnvelope` updated to parse new flat shape.
- `wrapError` now returns `FlatErrorResponse` (flat shape, no `schemaVersion`). All thin wrappers updated accordingly.

## [2.9.0] — 2026-04-10

### Changed

- **AI tools — optional debug trace (JSONL)**: Added a low-noise, code-togglable
  debug trace system for `AutotaskAiTools` (`debug-trace.ts`). Tracing is off by
  default and writes compact append-only JSONL events for tool build, schema/description
  hints, execution/filter planning, label resolution, write blockers, response envelopes,
  and error paths.

### Fixed

- **AI tools — timezone-aware date handling**: Date values provided by the LLM are now
  correctly interpreted in the user's configured timezone (set in Autotask credentials)
  and converted to UTC before reaching the API, matching the behaviour of the standard node.
  - `filter_value` / `filter_value_2`: datetime field values are now converted from user
    timezone to UTC when the field's metadata type is `dateTime`.
  - `since` / `until`: now accept date strings in the user's configured timezone
    (e.g. `2026-01-15T09:00:00`) in addition to explicit UTC offsets
    (e.g. `2026-01-15T09:00:00Z`). Explicit offsets are always respected.
  - `createIfNotExists` write fields: date fields are now converted to UTC before being
    passed to compound helpers, which previously bypassed `CreateOperation.execute()`.

### Known Limitations

- Date values inside `filtersJson` are **not** automatically converted — they must be
  provided in UTC. The schema description now states this explicitly.
- Date filter values on UDF fields are not converted (UDFs are absent from `readFields`
  metadata at filter-build time).
- Date-only strings (e.g. `2026-01-15` with no time component) are not matched by the
  ISO datetime pattern and are not converted. Always include the time component.

## [2.9.0] - 2026-04-09 (unreleased)

### Changed

- **`describeOperation` operation**: New always-available metadata helper (alongside `describeFields`/`listPicklistValues`). Pass `targetOperation='<op>'` to get full documentation — purpose, parameters, and usage notes.
- **`getMany`/`getPosted`/`getUnposted`: `filtersJson` parameter**: Accepts a JSON array of Autotask `IFilterCondition` objects for complex filters (3+ conditions, nested OR/IN). Mutually exclusive with flat `filter_field` triplets. Recency/since/until always AND-appended on top.
- **`getMany`/`getPosted`/`getUnposted`: `returnAll` parameter**: When true, fetches ALL matching records via API-native pagination; response still subject to 100-record truncation safety valve.
- **`MAX_QUERY_LIMIT` raised 100 → 500; `MAX_RESPONSE_RECORDS` raised 25 → 100**: Reduces truncation noise for realistic result sets.
- **Tool description truncation suffix** now directs LLM to `describeOperation` for operation-specific detail.
- **`getMany` description updated**: Offset pagination de-emphasised; `filtersJson`/`returnAll`/ordering notes added.

- **Enforceable write resolution blocking**: Write operations (create, update, delete, approve, reject, move, transfer, createIfNotExists) are now blocked before execution when label/reference resolution fails. New `WRITE_RESOLUTION_INCOMPLETE` error type with structured context: `pendingConfirmations` (ambiguous matches with candidates), `unresolvedFields` (no-match fields), `infraErrors` (infrastructure failures during resolution), `impersonationFailed` (unresolvable impersonationResourceId). Previously, writes executed with raw unresolved values and returned advisory `safeToContinue: false` after the mutation. Read operations are unaffected — filter label resolution continues to degrade gracefully.
- **Description safety header + visible truncation**: `buildUnifiedDescription()` now places a write-safety header as the first section (guaranteed to survive truncation) when write operations are configured. Silent `.slice(0, 2000)` replaced with `truncateDescription()` that cuts at word boundary and appends a visible `...[description truncated — call with operation='describeFields' for full field detail]` suffix.

### Fixed

- **`isResolutionFailureWarning()` incomplete coverage**: Added detection for `'resolution error'` (non-infra exceptions), `'has no known entity type'` (unknown reference entity), and `'Could not resolve'` (no-match warnings). Previously these warning strings bypassed the resolution failure classifier, allowing writes to proceed with raw values.
- **Impersonation catch warning missing `[INFRASTRUCTURE]` prefix**: The catch block in impersonation resolution now prefixes its warning with `[INFRASTRUCTURE]`, consistent with `label-resolution.ts` error handling.
- **Case mismatch in write guard impersonation exclusion**: `buildWriteResolutionBlocker()` filtered `'Impersonation'` (capital I) but actual warnings use lowercase `'impersonation'`. Fixed to match actual casing.
- **`createIfNotExists` double-prefix bug**: All three `wrapSuccess`/`wrapError` call sites for `createIfNotExists` compound operations were passing `` `${resource}.createIfNotExists` `` as the `operation` argument. Because `buildOperationString` internally prepends `${resource}.`, the final envelope `operation` field was double-prefixed (e.g. `ticket.ticket.createIfNotExists`). All three sites now pass the literal `'createIfNotExists'`, producing the correct `ticket.createIfNotExists`.
- **`summary` operation missing envelope metadata**: The `summary` case in `formatToolResponse` omitted the `extras` argument to `buildResultPayload`, causing `warnings`, `pendingConfirmations`, and `appliedResolutions` to always be empty in summary responses regardless of what label resolution produced. The standard extras block is now passed from `context`, consistent with all other operation families.

## [2.9.0] - 2026-04-09

### Added

- **Change Info Field aliases (credential-level)**: Ticket read operations (`get`, `getMany`, `getManyAdvanced`, `slaHealthCheck`, AI tool reads) can now append stable alias fields alongside the canonical `changeInfoField1..5`. Enable `Enrich Ticket Output with Change Info Field Aliases` in the credential and configure up to 5 alias names (defaults: `issueBusinessImpact`, `changesToBeMade`, `implementationPlan`, `reversionPlan`, `risksInvolved`). Output fields are named `changeInfoField{N}_{alias}`. Original fields are preserved unchanged. Aliases are normalised to safe property-name tokens; blank aliases fall back to `field1`..`field5`; duplicate tokens are suffixed deterministically (`_2`, `_3`, …).
- **New resource: Change Request Link**: `get`, `getMany`, `count`, `create`, `delete`, `createIfNotExists`. Idempotent link between a Change Request ticket and a Problem/Incident ticket (dedup: `changeRequestTicketID` + `problemOrIncidentTicketID`).
- **Ticket: Summary**: New operation (`ticket.summary`) providing a compact, type-aware summary of any Autotask ticket. Accepts `id` or `ticketNumber`. Automatically detects ticket type (Change Request, Incident, Problem, Service Request, Alert) and prioritises the most relevant fields. Filters out null/empty fields; truncates long text fields (`description`, `resolution`) to a configurable `summaryTextLimit` (default 500 chars). Reference label enrichment, picklist label enrichment, and UDF flattening are always applied — no per-operation toggles required. Returns four enrichment blocks alongside the filtered summary: `computed` (ageHours, daysSinceLastActivity, isAssigned; for open tickets: isOverdue + hoursUntilDue or hoursOverdue; when SLA assigned: slaStatus, slaNextMilestoneDueHours, slaEarliestBreachHours — all derived from ticket's own fields using the same milestone logic as slaHealthCheck), `relationships` (linkedProblem, project, opportunity — when present), `childCounts` (notes, timeEntries, attachments, additionalConfigurationItems, additionalContacts, checklistItems with completed/remaining breakdown, changeRequestLinks for CR tickets — fetched in parallel), and `_meta` (detectedTicketType, excludedFieldNames, truncatedFields, countErrors, generatedAt). Set `includeRaw=true` to receive the full enriched payload before alias renaming — label/UDF enrichments intact, original `changeInfoField{N}` keys, no null filtering or truncation — with `_meta.suppressedCanonicalFields` and `_meta.aliasMap` providing canonical↔alias traceability when Change Info aliases are active. Available in both the standard node and AI Tools.

### Fixed

- **`createIfNotExists` not-found outcomes now return `ErrorEnvelope`**: `company_not_found`, `contract_not_found`, `ticket_not_found`, `project_not_found`, `holiday_set_not_found` outcomes now return `ErrorEnvelope` (ENTITY_NOT_FOUND) instead of a success envelope.
- **`ticket.summary` `_meta` transformation audit trail**: The `_meta` block now explicitly records how summarisation shaped the result. Added: `typeDetectedBy` (`'label'` / `'numericField'` / `'fallback'` — explains which field drove type detection), `rawIncluded` (boolean — whether the raw enriched payload is included), `transformationsApplied` (ordered string array — e.g. `['aliasExpansion', 'nullFiltering', 'textTruncation', 'typeAwareOrdering']`), `prioritisedFields` (string array — fields placed in the universal or type-specific priority buckets), `truncationApplied` (boolean — true when any field was truncated; complements the existing `truncatedFields` detail), `countsPartial` (boolean — true when at least one count fetch failed; complements `countErrors`). Removed the uninformative `typeAwarePrioritisationApplied: true` flag (superseded by `transformationsApplied`). Field ordering within `_meta` is now stable and grouped by concern: identity → detection → options → transformations → fields → aliases → truncation → counts.
- **`ticket.summary` pure-transform refactor**: `buildTicketSummary` no longer mutates the `ticket` object passed by the caller. All enrichment (alias injection, canonical key removal, text truncation) now operates on an internal working copy. The input ticket is untouched after the call returns, making the helper safe to reuse across node execution, AI tools, and tests without defensive copying at the call site.
- **`ticket.summary` `raw` is now truly canonical**: When `includeRaw=true`, the `raw` payload is now captured after label/UDF enrichment but before alias renaming — it contains the original `changeInfoField{N}` keys and is unaffected by Change Info alias settings. Previously `raw` was captured post-alias (after originals were deleted), making it impossible to recover canonical field names from it.
- **`ticket.summary` `_meta` now includes alias traceability**: When Change Info aliases are active, `_meta` now includes `suppressedCanonicalFields` (array of suppressed canonical keys) and `aliasMap` (object mapping canonical→aliased key name), making the alias transformation fully traceable without duplicating field values.
- **Remove `usableAsTool: true` from AutotaskAiTools**: Caused n8n to register a phantom `AutotaskAiToolsTool` variant that throws at runtime (n8n PR #13075). Dedicated tool nodes with `supplyData()` must not use this flag.
- **`runtime.ts` two-strategy module resolution**: `getRuntimeRequire()` now tries `require.main` first, preventing local devDep copies of `@langchain/core` from shadowing n8n's copy (fixes `instanceof` failures).
- **Resolve `zod` from n8n's top-level `node_modules`**: `@langchain/classic` bundles a nested `zod` copy that differs from n8n's top-level `zod`. `normalizeToolSchema` in `n8n-nodes-langchain` does `instanceof ZodType` against the top-level copy — schemas built with the nested copy fail that check and get corrupted ("object schema missing properties"). Zod is now resolved from `require.main` separately from `DynamicStructuredTool`.
- **`ticket.summary` computed block — `isOverdue`/`hoursUntilDue` split**: Resolved tickets no longer emit `isOverdue: false` (a resolved-after-due ticket previously gave false reassurance). For open tickets, `hoursUntilDue` is now only emitted when positive (ticket not yet overdue). New field `hoursOverdue` (positive magnitude) is emitted instead when an open ticket is past its due date. Both fields are absent for resolved tickets.
- **`ticket.summary` computed block — SLA logic unified with `slaHealthCheck`**: The SLA status and milestone timing fields in `ticket.summary` now use `computeMilestoneStatus` from a new shared helper (`helpers/sla-milestone.ts`), eliminating parallel reimplementation. `slaStatus` now checks all three SLA milestones (first response, resolution plan, resolution) rather than only `resolvedDueDateTime`. A milestone is only counted as breached when its actual date is absent — milestones already met do not count as breaches.
- **`ticket.summary` computed block — `slaNextDueHours` renamed and split**: Replaced by two semantically distinct fields. `slaNextMilestoneDueHours`: hours until the next upcoming unmet milestone (positive only; absent when no future milestones). `slaEarliestBreachHours`: hours since the earliest unmet overdue milestone (positive magnitude; absent when no breaches). Previously `slaNextDueHours` included negative values and picked the most-overdue past milestone rather than the next upcoming one.

### Changed

- **Result Envelope Standard v2**: `SuccessEnvelope.result` is now a typed `ResultPayload` instead of `unknown`. Every success response has a consistent shape: `kind`, `data`, `flags`, `warnings`, `pendingConfirmations`, `appliedResolutions`, plus optional `pagination` (list kind) and `notes`. `kind` discriminator: `item | list | count | mutation | compound | summary | metadata`. `flags` block always present: `mutated`, `retryable`, `partial`, `truncated`, `needsUserConfirmation`, `safeToContinue`. `warnings[]`, `pendingConfirmations[]`, `appliedResolutions[]` always present (never absent). `searchByDomain` always returns `kind: list` regardless of result count. `createIfNotExists` compound data normalised: entity-specific ID fields unified to `id`/`existingId`; parent/scope fields in `context` block. `resolvedLabels` renamed to `appliedResolutions`. `result.itemId` (create/update) renamed to `result.data.id` under `mutation` kind. `recencyWindowLimited` warning now routes to `warnings[]`. `safeToContinue` defined as `!needsUserConfirmation && !partial`.
- **Tightened identifier-pair schema contract**: `ticket.slaHealthCheck` and `ticket.summary` field descriptions now use imperative, rejection-aware language — `id` and `ticketNumber` descriptions state "exactly one must be present; calls with neither identifier are rejected immediately with INVALID_FILTER_CONSTRAINT." The `operation` enum description is annotated with the identifier requirement when identifier-pair operations are present. The `ticket.summary` operation summary line now states the identifier requirement. Long-form descriptions for both operations lead with the identifier constraint. Runtime pre-flight checks in `tool-executor.ts` remain as the enforcement layer.
- **`ticket.summary` extended type-aware prioritisation**: Added dedicated field priority profiles for Problem, Service Request, and Alert ticket types. Problem surfaces assignment, role, queue, SLA milestones, and resolution timeline (same set as Incident — root-cause investigations share that operational context). Service Request surfaces assignment, role, queue, due date, estimated hours, and all SLA milestone fields. Alert surfaces assignment, queue, due date, first-response milestone, and SLA. The Unknown/fallback profile is unchanged. Previously all non-Change-Request, non-Incident tickets fell through to a minimal default (assignedResource, queue, dueDateTime, estimatedHours).
- **Centralised ticket type detection**: Extracted `TicketType`, `TICKET_TYPE_NUMERIC`, and `detectTicketType` into `helpers/ticket-type.ts`; removed duplicated inline logic from `resources/tickets/execute.ts`.
- **Add `logWrapper` from `@n8n/ai-utilities` (best-effort)**: Tool returned from `supplyData()` is now wrapped with `logWrapper` when available, adding input/output logging to n8n's execution view. Gracefully skipped if unavailable.
- **Dev dependency updates**: `@langchain/core` 0.3→1.x, `@langchain/classic` 1.0.29, `n8n-workflow` 2.x, `@types/node` ^22. Removed `@types/moment-timezone`.
- **`NodeConnectionType` enum → string literals**: Reverted the v2.7.0 enum imports back to plain string literals (`'main'`, `'ai_tool'`) across all three node files for compatibility with `n8n-workflow` 2.x which changed the enum export.
- **tsconfig.json `paths` for `@langchain/core` 1.x**: Added subpath mapping for `@langchain/core/tools` — required because `@langchain/core` 1.x uses package.json `exports` which `moduleResolution: "node"` does not resolve.
- **UI property ordering**: `fieldsToMap` resource mapper now renders after shared getMany options in the standard node UI.
- **Ticket identifier contract — centralised registry**: Introduced `IDENTIFIER_PAIR_OPERATIONS` in `constants/resource-operations.ts` as the single source of truth for operations that accept `id` OR `ticketNumber`. `schema-generator.ts` and `tool-executor.ts` derive all identifier-pair behaviour from this registry. Adding a future operation (e.g. `ticket.timeline`) requires only one registry entry instead of seven scattered edits.
- **Ticket summary/slaHealthCheck pre-flight validation**: Missing-identifier calls now return a structured `INVALID_FILTER_CONSTRAINT` error with actionable guidance instead of an unhandled runtime exception. Schema descriptions and operation descriptions now explicitly state that at least one of `id` or `ticketNumber` is required.
- **`ticket.summary` configurable child-count enrichment**: Added `includeChildCounts` parameter (boolean, default `false`). When `false` (default), all child-count API calls (notes, time entries, attachments, additional CIs, additional contacts, checklist items, change request links) are skipped and the `childCounts` block is omitted from the response. Set `true` to fetch child counts and include the block. `_meta.childCountsIncluded` always reflects the chosen mode; `_meta.countsPartial` is `false` when counts were not fetched.

## [2.8.0] - 2026-04-07

### Changed

- **`createIfNotExists` drift-update via `updateFields`**: All 13 compound operations accept an optional `updateFields` parameter. When a duplicate is found and `errorOnDuplicate` is false, listed fields are compared against the existing record and any drifted fields are patched. Response includes `outcome: 'updated'` with changed fields, or `outcome: 'skipped'` when nothing changed. Omitting `updateFields` leaves existing behaviour unchanged.
- **New resource: Resource Role Queue**: `get`, `getMany`, `count`, `create`, `update`. Resource-to-queue role assignments.
- **New resource: Expense Report**: `get`, `getMany`, `count`, `create`, `update`. Expense reports submitted by resources for approval and reimbursement.
- **New resource: Expense Item**: `get`, `getMany`, `count`, `create`, `update`, `createIfNotExists`. Line items on an expense report.
- **New resource: Expense Item Attachment**: `getMany`, `count`, `create`, `download`, `delete`. Receipt files attached to expense items. Standard node only.
- **New resource: Ticket Additional Contact**: `get`, `getMany`, `count`, `create`, `delete`, `createIfNotExists`. Additional contact associations on a ticket.
- **New resource: Ticket Additional Configuration Item**: `get`, `getMany`, `count`, `create`, `delete`, `createIfNotExists`. Additional configuration item associations on a ticket.
- **New resource: Department**: `get`, `getMany`, `count`, `create`, `update`. Organisational units for resource assignment.
- **Opportunity**: Added `createIfNotExists`; fixed `get` not being available in the AI tools node.
- **New resource: Opportunity Attachment**: `getMany`, `count`, `create`, `download`, `delete`. Files attached to opportunities.
- **New resource: Opportunity Category**: `get`, `getMany`, `count`, `update`. Pipeline category records.
- **Credential zone label**: Renamed `Australia / New Zealand` (webservices6) to `Old Australian zone (webservices6)`.
- **New resource: Holiday Set**: `get`, `getMany`, `count`, `create`, `update`, `delete`, `createIfNotExists`. Named groups of holidays used for scheduling.
- **New resource: Holiday**: `get`, `getMany`, `count`, `create`, `update`, `delete`, `createIfNotExists`. Individual holiday dates within a holiday set.
- **Skill**: `get`, `getMany`, `count` now available in the AI tools node. Skills are read-only system-defined proficiency categories.
- **New resource: Resource Skill**: `get`, `getMany`, `count`, `update`. Skill proficiency assignments linking a resource to a skill with an associated level.
- **New resource: Time Off Request**: `get`, `getMany`, `count`, `approve`, `reject`. Read and action time off requests submitted by resources.
- **New resource: Resource Time Off Additional**: `get`, `update`. Annual and additional time-off hour quotas (vacation, personal, sick, floating holiday) per resource per year. AI tools: `getByResource` and `update` with resource name resolution.
- **New resource: Resource Time Off Approver**: `get`, `getMany`, `count`. Authorised approvers per resource for time off requests. Reference fields `resourceID` and `approverResourceID` support name-based resolution in AI tools.
- **New resource: Resource Time Off Balance**: `get` (all years), `getByYear` (specific year). Accrued, used, planned, and waiting-approval hours per resource per year. AI tools: `getByResource` and `getByYear` with resource name resolution.
- **New AI operations**: `getByResource` and `getByYear` — two new special operations for parent-path entities where records are accessed by `resourceID` rather than their own record ID.

### Fixed

- **`createIfNotExists` fallback for unimplemented resources**: Previously fell through silently to `executeToolOperation`; now returns explicit `INVALID_OPERATION` error with guidance to use `create` instead.
- **`getByResource`/`getByYear` empty-array false positive**: Empty array `[]` was incorrectly treated as `ENTITY_NOT_FOUND`; now returns a valid success response (resource exists, no entries).
- **Label resolution failure for non-numeric resource IDs**: `resourceTimeOffBalances` and `resourceTimeOffAdditional` now throw an actionable error when name→ID resolution fails instead of passing the raw string into the API URL.
- **Holiday set dedup skip warning**: Logs a warning when dedup fields are configured but values are undefined in `createFields`, instead of silently skipping the dedup check.
- **Attachment error context**: All 5 attachment handlers now include parent entity ID and filename in the error message when the API response lacks an attachment ID.
- **Impersonation for approve/reject/delete**: `isWriteOperation` gate now includes `approve`, `reject`, and `delete` operations for impersonation resource ID resolution.
- **`expenseItem` dedup fields**: Removed redundant `expenseReportID` (already scoped by parent); dedup now uses `['expenseDate', 'description']`.
- **`isNumericId` tightening**: `contract-service-creator` and `ticket-charge-creator` now reject zero, negative, and zero-padded string IDs.
- **Silent `catch` blocks**: `resourceTimeOffAdditional` and `resourceTimeOffBalances` now log resolution failures via `console.warn` instead of swallowing silently.
- **ResourceMapper defaults**: `ticketAdditionalConfigurationItems` and `ticketAdditionalContacts` use `{ mappingMode: 'defineBelow', value: null }` instead of `{}`.
- **Missing executor registration**: `expenseItemAttachment` added to `RESOURCE_EXECUTORS` in `tool/execute.ts`.
- **Department UI fixes**: `count` operation was missing from the dropdown; `update` operation referenced the wrong resource mapper name.
- **Holiday `delete` missing parent ID**: `holidaySetID` was not passed on delete operations.
- **`resourceTimeOffAdditional` get response shape**: Used `.item` (singular) instead of `.items` array from `QueryActionResult`, returning wrong data shape.
- **Opportunity `createIfNotExists` dedup**: Server-side dedup filter, `DEFAULT_DEDUP_FIELDS`, and `company_not_found` reason were incorrect.
- **`parentUrlSegment` entity metadata**: Added override field to `IEntityMetadata` for child entities with non-standard URL segment names (e.g. expense item attachments).

## [2.7.2] - 2026-04-02

### Fixed

- **Strip `Prompt__*` framework fields from execute() path**: Agent Tool Node v3 injects `$fromAI()`-generated keys like `Prompt__User_Message_` into `item.json`. The `supplyData()` → `func()` path was unaffected (Zod strips unknown keys), but the `execute()` path (Agent V3) passed raw `item.json` to the executor, causing `INVALID_WRITE_FIELDS` errors on write operations. Added `N8N_METADATA_PREFIXES = ['Prompt__']` with prefix-based stripping alongside the existing exact-match `N8N_METADATA_FIELDS`

## [2.7.1] - 2026-04-02

### Fixed

- **n8n 2.14.x AI tool execution compatibility**: Tool invocations through `execute()` were returning "This is an AI Tool node. Connect it to an AI Agent node to use it." instead of executing the operation. n8n 2.14.x routes AI tool calls through `execute()` with params in `item.json` (including `operation`) but without the `tool` field that older versions injected. The guard now detects tool calls via `operation` OR `tool` presence. Additionally, `execute()` now fetches field metadata for label resolution parity with `supplyData()`, includes `describeFields`/`listPicklistValues` in allowed operations, and passes field metadata to `executeAiTool()`

## [2.7.0] - 2026-04-02

### Changed

- **Proxy-based top-level runtime exports**: `runtime.ts` now exports `RuntimeDynamicStructuredTool` and `runtimeZod` as Proxy-wrapped top-level constants alongside the existing `getLazyRuntimeDST()` / `getLazyRuntimeZod()` lazy getters. The Proxy approach defers resolution identically (errors surface at invocation, not module load) but provides a cleaner import API — consumers use `new RuntimeDynamicStructuredTool(...)` directly instead of `new (getLazyRuntimeDST())(...)`

### Fixed

- **Proxy [[Construct]] compatibility**: The `RuntimeDynamicStructuredTool` Proxy target is `function () {}` (not `{}`). Per ECMAScript §10.5.13, a Proxy only has a `[[Construct]]` internal method if its target does — plain objects lack `[[Construct]]`, so `new Proxy({}, { construct… })` throws `TypeError: RuntimeDynamicStructuredTool is not a constructor` before the construct trap ever fires. The function target provides `[[Construct]]` so the Proxy's construct trap delegates correctly to n8n's resolved `DynamicStructuredTool` class
- **`NodeConnectionTypes` → `NodeConnectionType` enum**: Fixed build compatibility with n8n-workflow 1.70.0 — the old `NodeConnectionTypes` enum was removed. All three node files (`Autotask.node.ts`, `AutotaskAiTools.node.ts`, `AutotaskTrigger.node.ts`) now use the `NodeConnectionType` enum value import (e.g. `NodeConnectionType.Main`, `NodeConnectionType.AiTool`) instead of string literals with casts

## [2.6.1] - 2026-03-19

### Fixed

- **Lazy LangChain runtime initialisation**: Deferred `DynamicStructuredTool` and `zod` resolution from module load time to first `supplyData()` call. Previously, importing `runtime.ts` eagerly resolved `@langchain/classic/agents` at startup — if LangChain was unavailable (older n8n, missing AI features), the entire node package (including the standard Autotask and AutotaskTrigger nodes) was marked as errored in the n8n UI. Now only the AI Tools node fails gracefully when LangChain is absent.

## [2.6.0] - 2026-03-19

### Changed

- **Compound operations — `createIfNotExists`**: Added idempotent create-if-not-exists operations to 7 entities: `contractCharge`, `ticketCharge`, `projectCharge`, `configurationItems`, `timeEntry`, `contractService`, and `contract`. Each follows the find-parent → check-duplicates → resolve-references → create pattern with configurable dedup fields and `errorOnDuplicate` control. Outcomes: `created`, `skipped` (duplicate found), or entity-specific not-found (e.g. `contract_not_found`, `ticket_not_found`, `company_not_found`)
- **Charge family refactoring**: Extracted shared charge creation logic into `helpers/charge-creator-base.ts` — `contractCharge`, `ticketCharge`, and `projectCharge` now share ~90% of code via parameterised config
- **Dynamic dedup fields**: All `createIfNotExists` operations accept dynamic dedup field names via `rz.array(rz.string())` (AI tools) or multiOptions dropdown (standard node). Users call `describeFields` to discover valid field names.
- **Shared dedup utilities**: New `helpers/dedup-utils.ts` provides field-type-aware comparison (`compareDedupField`), date normalisation, quantity rounding, and response extraction helpers
- **New helper files**: `contract-charge-creator.ts` (refactored to shared base), `ticket-charge-creator.ts`, `project-charge-creator.ts`, `configuration-item-creator.ts`, `time-entry-creator.ts`, `contract-service-creator.ts`, `contract-creator.ts`
- **createIfNotExists aligned with create pattern**: All 7 `createIfNotExists` operations now use the same dynamic resourceMapper/entity-metadata for fields as the `create` operation — no hardcoded field definitions. Only `dedupFields` and `errorOnDuplicate` remain as operation-specific additions. Helper interfaces simplified to `{ createFields: Record<string, unknown>, dedupFields, errorOnDuplicate }` with `createFields` keys being API field names.
- **AI tools createIfNotExists schema**: Uses dynamic `writeFields` loop (same as create/update) instead of per-entity hardcoded Zod fields. Gains field validation (`validateWriteFields`) and label resolution (`resolveLabelsToIds`) — LLM can now pass human-readable names for picklist/reference fields.
- **AI tools field name change**: createIfNotExists schema now shows API field names (e.g., `name` instead of `chargeName`, `isBillableToCompany` instead of `isBillable`). This is consistent with the `create` operation schema.
- Removed `fieldNameToApiName` from `ChargeCreatorConfig` — no longer needed since `createFields` uses API field names directly
- Replaced 7 per-entity AI description functions with single generic `buildCreateIfNotExistsDescription`

### Fixed

- `createIfNotExists` now included in `isWriteOperation` checks in both `tool-executor.ts` and `resources/tool/execute.ts`
- `needsWriteFields` in `AutotaskAiTools.node.ts` now includes `createIfNotExists` so write field metadata is fetched for schema generation

## [2.5.2] - 2026-03-17

### Fixed

- Set `usableAsTool: false` on AutotaskTrigger node — trigger nodes don't support tool wrapping, `true` caused n8n to fail with "Unrecognized node type" at startup

## [2.5.1] - 2026-03-16

### Fixed

- Removed unnecessary `index.ts` from tsconfig include; dropped `DOM` lib; target lowered to `es2019` to match `@n8n/node-cli` template

## [2.5.0] - 2026-03-16

### Infrastructure

- Added n8n codex metadata to `AutotaskAiTools` node — registers it under the AI → Tools category so n8n's node panel correctly lists it alongside other AI tool nodes
- Migrated build tooling to `@n8n/node-cli` (`n8n-node build`/`lint`/`dev`), replacing gulp + rimraf
- Modernized ESLint from legacy `.eslintrc.js` to flat config (`eslint.config.mjs`) with ESLint 9
- Bumped TypeScript target from ES2019 to ES2022
- Removed 7 devDependencies (`@eslint/js`, `@typescript-eslint/*`, `eslint-plugin-n8n-nodes-base`, `globals`, `gulp`, `rimraf`), added `@n8n/node-cli`
- Added `typecheck`, `release`, `format:fix`, `build:watch` scripts
- Added `.prettierignore`

### Changed

- **AI Tools — Name-based label resolution for write operations:** Create and update operations now auto-resolve human-readable names to numeric IDs for picklist and reference fields. The LLM passes a string label in the *same field* that would normally take a numeric ID — e.g. `resourceID: "Will Spence"` instead of `resourceID: 29683`, or `status: "In Progress"` instead of `status: 5`. Resolution is transparent — successful responses include a `resolvedLabels` array showing each `{ field, from, to, method }` mapping. Ambiguous or unresolvable labels produce `resolutionWarnings`; partial/substring matches produce `pendingConfirmations` for LLM-driven user confirmation. Resolution is best-effort: numeric IDs still work as before, and if resolution fails the error is surfaced in `resolutionWarnings` and the raw value passes through to the API. Implementation: `resolveLabelsToIds()` in `helpers/label-resolution.ts` is called from `tool-executor.ts` after `validateWriteFields()` but before the `getNodeParameter` override, so resolved values flow into `fieldsToMap`, `bodyJson`, and `requestData`.
- **AI Tools — Label resolution for read filters:** `getMany`, `count`, `getPosted`, and `getUnposted` operations now auto-resolve human-readable names to numeric IDs for reference and picklist filter values. When `filter_field` is a reference or picklist field and `filter_value` is a non-numeric string, the tool resolves it before building the API filter — e.g. `filter_field='companyID', filter_value='Contoso'` auto-resolves to `companyID=42`. Uses the same two-pass active→all strategy and `pendingConfirmations` for ambiguous matches as write label resolution. Resolved labels appear in the response `resolvedLabels` array. Implementation: `resolveFilterLabelsToIds()` in `helpers/label-resolution.ts`, called from `tool-executor.ts` after `buildFilterFromParams()`.
- **AI Tools — Schema accepts string|number for picklist/reference fields:** Zod schemas for write operations now use `rz.union([rz.number(), rz.string()])` for fields where `field.isPickList || field.isReference` in `schema-generator.ts`. Without this, `rz.number()` schemas reject string labels before they reach the resolution layer. Non-picklist, non-reference number fields remain `rz.number()` only.
- **AI Tools — Required fields embedded in tool descriptions:** Create operation descriptions now include a compact required-fields summary with type info — reference fields show their target entity (e.g. `companyID (ref→Company)`), picklist fields with ≤10 values inline the options (e.g. `status (picklist: New|In Progress|Complete)`), larger picklists show count + hint. This eliminates the `describeFields` prerequisite call for 80%+ of create workflows.
- **AI Tools — Pagination via offset parameter:** List operations (`getMany`, `getPosted`, `getUnposted`) now accept an `offset` parameter to skip records. Response includes `offset`, `hasMore`, and `nextOffset` fields for pagination context. Pagination is limited to the first 100 records (`MAX_QUERY_LIMIT`); offset ≥ 100 returns an `INVALID_FILTER_CONSTRAINT` error directing the LLM to narrow filters instead.
- **AI Tools — Impersonation name→ID resolution:** The `impersonationResourceId` parameter now accepts a human-readable name or email address instead of requiring a numeric resource ID. String values are auto-resolved against the Resource entity using exact name match or email field match (`email`, `email2`, `email3`). Schema changed from `rz.number()` to `rz.union([rz.number(), rz.string()])`. Resolved values appear in `resolvedLabels`.
- **AI Tools — OR filter logic between filter pairs:** New `filter_logic` parameter for list operations accepts `'and'` (default) or `'or'` to control how the two filter triplets are combined. This eliminates the double-call pattern for compound queries like "tickets that are Open OR In Progress". Implementation adds `or` to `FilterOperators` and `FilterOperator` type; `tool-executor.ts` builds a pre-structured `{ op: 'or', items: [...] }` group directly, and `finalizeResourceMapperFilters()` in `helpers/filter.ts` wraps the top-level array with AND when multiple items exist.
- **AI Tools — Updated create/update/getAll descriptions:** Tool descriptions now inform the LLM that name-based resolution is available for picklist and reference fields (writes and read filters). The unified description summaries for create/update also mention the feature. Reference field descriptions in `buildFieldDescription()` include "accepts ID or name".
- **AI Tools — Label resolution: partial matches → pendingConfirmations:** Substring/partial matches for both picklist and reference fields are never auto-resolved. Instead, candidates are returned in a `pendingConfirmations` array (`PendingLabelConfirmation[]`) so the LLM can ask the user to confirm the correct match.
- **AI Tools — Label resolution: two-pass active→all for references:** Reference label resolution now searches active entities first, then falls back to all entities (including inactive) only when no match is found in the active set.
- **AI Tools — Label resolution: picklist cache:** `listPicklistValues()` results are cached per field within a single `resolveLabelsToIds()` call, avoiding redundant API calls.
- **AI Tools — Label resolution: infrastructure error classification:** Reference resolution errors are classified as `[INFRASTRUCTURE]` when the error message matches network/auth patterns (timeout, ECONNREFUSED, 401, 403, etc.), distinguishing transient failures from logic errors.

### Fixed

- **AI Tools — Double-offset bug in pagination:** The `offset` parameter was being sent to the API AND applied client-side, causing double-skip that returned empty or wrong records. Offset is now purely client-side as designed.
- **AI Tools — OR filter logic incorrectly folded recency filters:** When `filter_logic='or'` was used with `recency` or `since/until`, the recency date constraint was OR-grouped with user filters instead of being ANDed on top. Now user filters are wrapped in an OR group while recency filters are always ANDed externally.
- **AI Tools — `_logic` marker leaked into API payload:** The internal `_logic` filter marker was included in the `requestData` JSON sent to the API. Removed the marker approach entirely; OR grouping is now built as a proper nested filter structure before passing to downstream paths.
- **AI Tools — Filter mutation in `finalizeResourceMapperFilters`:** `delete fAny._logic` mutated the caller's original filter objects. Now shallow-copies each filter before stripping internal markers.
- **AI Tools — `searchByDomain` dropped multiple results:** When a domain search returned multiple companies, only the first was returned. Now returns `{ items, count }` when multiple matches exist.
- **AI Tools — Redundant API call in reference label resolution:** `helper.getValues(false)` was called twice when no exact match was found — once for the exact-match pass and again for the partial-match collection. Hoisted the variable to avoid the duplicate call in both `resolveLabelsToIds` and `resolveFilterLabelsToIds`.
- **AI Tools — Fragile pendingConfirmations dedup guard:** The "don't warn if pendingConfirmation already exists for this field" check used a last-element comparison instead of set membership, which could miss fields processed earlier. Now uses a `Set<string>` for reliable deduplication.
- **AI Tools — Offset beyond available records returned misleading "no results":** When `offset` exceeded the number of available records, the empty slice was treated as a filter mismatch, potentially causing LLM data fabrication. Now returns a clear `INVALID_FILTER_CONSTRAINT` error.
- **AI Tools — Recency + offset interaction undefined:** When recency was active, `offset` was silently ignored but `hasMore`/`nextOffset` still emitted misleading values. Now suppresses `hasMore`/`nextOffset` in recency mode and adds an explanatory note when offset is ignored.
- **AI Tools — `in`/`notIn` filter label resolution gap:** Array filter values on reference/picklist fields silently bypassed label resolution with no warning. Now emits a warning directing the LLM to use numeric IDs for array filter values.
- **AI Tools — `isLikelyId` accepted 0 and negative numbers:** `isLikelyId("0")` and `isLikelyId(0)` returned true, bypassing label resolution for invalid IDs. Now requires positive integers (>0).
- **AI Tools — `isLikelyId` rejects zero-padded strings:** The ID detection now uses a `parseInt` round-trip check, rejecting values like `"00123"` that look numeric but aren't valid IDs.
- **AI Tools — Label resolution silent catch replaced:** The bare `catch {}` around `resolveLabelsToIds()` in `tool-executor.ts` now captures and surfaces the error message as a `labelWarnings` entry, preventing silent failures.
- **AI Tools — Debug logging for unrecognized fields:** Fields not found in write metadata now produce a `console.debug` log with the field name and resource, aiding troubleshooting of schema mismatches.
- **AI Tools — Reference resolution Pass 2 skipped when active set had partial matches:** When looking up a reference label (e.g. `"John Smith"`), if the active entity set contained only partial matches (e.g. `"John Smithson"`), Pass 2 (all entities including inactive) was never reached — so an exact match against an inactive entity was missed. Both `resolveLabelsToIds` and `resolveFilterLabelsToIds` now always attempt Pass 2 when no exact match is found, regardless of active partial matches. Partial matches from both passes are merged and deduplicated in `pendingConfirmations`.
- **AI Tools — Picklist resolution missing try/catch in `resolveLabelsToIds`:** A network error on `listPicklistValues()` for one picklist field would abort resolution for ALL remaining fields. Now wrapped in try/catch matching the pattern already used in `resolveFilterLabelsToIds`.
- **AI Tools — Empty-string labels skipped in `resolveLabelsToIds`:** Whitespace-only values (e.g. `" "`) now skip resolution instead of attempting API lookups with an empty label. `resolveFilterLabelsToIds` already had this guard.
- **AI Tools — `hasMore` pagination used raw `params.limit` instead of capped limit:** When the LLM passed a limit above `MAX_QUERY_LIMIT` (100), `hasMore` was always `false` because it compared against the uncapped value. Now uses `getEffectiveLimit()` consistently.
- **AI Tools — Deduplicated `isLikelyId` utility:** Extracted `isLikelyId` to a shared module-level function, eliminating identical closures in `resolveLabelsToIds` and `resolveFilterLabelsToIds`.
- **AI Tools — Impersonation email matching only checked first email field:** The `??` chain (`email ?? email2 ?? email3`) short-circuits at the first non-null value, so `email2`/`email3` were never compared if `email` existed but didn't match. Now checks all three email fields independently.
- **AI Tools — Offset bounds check fired for `count` operations:** The offset cap (`>= 100`) check ran before operation routing, returning an inappropriate error for `count` which doesn't use offset. Now scoped to list-style operations only (`getMany`, `getPosted`, `getUnposted`).
- **AI Tools — `count` queryLimit inflated by offset:** When `offset > 0` was supplied alongside a `count` operation, the API received an unnecessarily large `limit`. Now offset inflation only applies to operations that use offset pagination.
- **AI Tools — `mapFilterOp` accepted `'and'`/`'or'` as field-level operators:** After adding `and`/`or` to `FilterOperators` for grouping, they were also accepted by `mapFilterOp` as valid field comparison operators. Now explicitly rejected with a helpful error directing to `filter_logic`.
- **AI Tools — `domainOperator` schema included `'like'`:** The `'like'` operator was in the Zod enum for `domainOperator` but bypassed `mapFilterOp` normalization. Removed from the AI schema since `'contains'` is the canonical equivalent.
- **AI Tools — Posted/unposted time entry descriptions missing OR and offset:** `getPosted`/`getUnposted` descriptions referenced "AND filters" only, not mentioning the new `filter_logic='or'` or `offset` pagination support.
- **AI Tools — Unresolved impersonation name leaked raw string to API:** When `impersonationResourceId` was a non-numeric string that failed name resolution, the raw string was passed through to `getOptionalImpersonationResourceId()` which threw a type error. The composed warning in `labelWarnings` was discarded and the LLM received a generic `API_ERROR`. Now returns `fallbackValue` (undefined) for unresolved non-numeric strings, allowing the operation to proceed without impersonation while surfacing the warning.
- **AI Tools — Impersonation resolution ran for all operations including reads:** The impersonation name→ID resolution block fetched the full active Resource entity list unconditionally, wasting an API call on read operations that don't use impersonation. Now gated to write operations only.
- **AI Tools — Filter label resolution missing "could not resolve" warnings:** `resolveFilterLabelsToIds` silently returned unresolved values when no exact or partial matches were found for both picklist and reference filter fields. The write-path equivalent (`resolveLabelsToIds`) correctly emitted warnings. Now produces `Could not resolve picklist/reference filter label` warnings.
- **AI Tools — Filter label resolution missing warning for reference fields without `referencesEntity`:** When a filter field was a reference type but had no `referencesEntity` metadata, `resolveFilterLabelsToIds` silently skipped it. Now emits a warning matching the write-path behavior.
- **AI Tools — Picklist resolution errors missing infrastructure classification:** Picklist `catch` blocks in both `resolveLabelsToIds` and `resolveFilterLabelsToIds` produced generic error messages without the `[INFRASTRUCTURE]` prefix used by reference resolution errors. Network/auth errors (timeout, ECONNREFUSED, 401, 403) during picklist resolution are now tagged consistently.
- **AI Tools — `filtersUsed` error context incomplete in no-results response:** The `formatNoResultsFound` context for empty `getMany`/`getPosted`/`getUnposted` results omitted `filter_value_2`, `filter_op`, `filter_op_2`, `filter_logic`, `since`, and `until`. Now includes all active filter parameters.
- **AI Tools — `buildRequiredFieldsSummary` showed raw type for picklists without `allowedValues`:** Required picklist fields with no inline `allowedValues` (e.g. large picklists) were labeled with their raw type (e.g. `integer`) instead of indicating they are a picklist. Now shows `(picklist — use listPicklistValues for options)`.
- **AI Tools — Lint: `let` → `const` for immutable array references:** `filterResolutions`, `filterWarnings`, `filterPendingConfirmations` in `tool-executor.ts` used `let` but were only mutated via `.push()`, not reassigned.
- **Lint compliance with `@n8n/node-cli` ESLint rules:** Resolved 951 lint errors/warnings introduced by the stricter `@n8n/eslint-plugin-community-nodes` ruleset. Added targeted ESLint overrides for `no-console` (server-side logging), `import-x/no-duplicates` (type-only vs value imports), `no-empty-object-type`, `no-unused-expressions`, and `no-deprecated-workflow-functions`. Added `icon` to credential class, `usableAsTool: true` to `AutotaskAiTools` and `AutotaskTrigger`, fixed company limit default (25→50) and description. Removed stale `eslint-disable` directives. Exported `MAX_OR_CONDITIONS`/`MAX_UDF_PER_QUERY` to fix unused-vars-as-type errors.

## [2.4.0] - 2026-03-13

### Changed

- **AI Tools — Result Envelope Standard:** All tool responses now use `SuccessEnvelope` / `ErrorEnvelope` with `schemaVersion: "1"`, enabling MCP clients and LLMs to reliably distinguish success from error and detect schema version changes. New `wrapSuccess()` / `wrapError()` factories and `ERROR_TYPES` named constants in `error-formatter.ts`.
- **AI Tools — `getMany` uses `items` instead of `results`:** List responses now return `{ items, count }` per envelope standard (was `{ results, count }`).
- **AI Tools — runtime.ts fail-fast:** `getRuntimeRequire()` now tries an `ANCHOR_CANDIDATES` array (`@langchain/classic/agents`, `langchain/agents`) and throws a diagnostic error listing all failed candidates instead of silently falling back to bundled `require`. This prevents hard-to-diagnose `instanceof` failures.

### Fixed

- **AI Tools — Write safety in execute() path:** The `execute()` method (Test Step / direct execution) now returns an explicit `WRITE_OPERATION_BLOCKED` error when a write operation is requested but not permitted, instead of silently falling back to a different operation.
- **AI Tools — Write safety in func() path:** The `func()` closure now checks for blocked write operations before returning `INVALID_OPERATION`, giving a specific `WRITE_OPERATION_BLOCKED` error with guidance.
- **AI Tools — Null guards for single-record operations:** `whoAmI`, `searchByDomain`, `slaHealthCheck`, `moveConfigurationItem`, `moveToCompany`, and `transferOwnership` now return `ENTITY_NOT_FOUND` errors instead of `{ result: null }`, preventing LLM data fabrication.
- **AI Tools — Default case in formatToolResponse:** Unknown operations now return a structured `INVALID_OPERATION` error instead of a bare array.
- **AI Tools — Delete description safety:** Added "ONLY on explicit user intent. Do not infer from context. Confirm ID is correct before proceeding." to delete operation descriptions.
- **AI Tools — Create/update description safety:** Added "Confirm field values with user before executing when acting autonomously." to create and update operation descriptions.

## [2.3.2] - 2026-03-13

### Fixed

- **Duplicate operations in Operation dropdown:** 'Get Entity Info', 'Get Field Info', and 'Get Many (Advanced)' appeared 4–7× for most resources, and 'Custom API Call' appeared 3×. Root cause: `addOperationsToResource` mutated shared module-level `*Fields` objects — `[...baseFields]` shallow-copies the array but shares the same property object references, so each `new Autotask()` call accumulated duplicate options into the original constants. Fixed by (a) cloning the operation property (index + spread) before mutating in `addOperationsToResource`, and (b) moving the node description to a module-level constant so `consolidateProperties` + all `addOperationsToResource` calls run exactly once per module load. The 'Custom API Call' ×3 issue is auto-fixed as a downstream consequence.

## [2.3.1] - 2026-03-13

### Fixed

- **AI Tools — field labels discarded in FieldMeta:** `aiHelper.ts` was setting `name: field.id` (camelCase) instead of `name: originalField?.label || field.id`. The Autotask API returns a human-readable `label` for every field (e.g. "Mobile Phone" for `mobilePhone`), but this was silently dropped. Now `FieldMeta.name` carries the label, which flows into every Zod `.describe()` call in the schema, giving the LLM semantic context for each field.
- **AI Tools — LLM omits optional fields it already has data for:** The `create` operation description in `buildUnifiedDescription` now includes: *"Populate every optional field for which you already have data — do not omit known information."* This addresses the pattern where the LLM only populates required fields despite having additional context.

## [2.3.0] - 2026-03-13

### Changed

- **AI Tools — unified single-tool-per-resource architecture (MCP queue-mode fix):** Each configured resource now exposes a single `DynamicStructuredTool` named `autotask_<resource>` (e.g. `autotask_ticket`) instead of N separate per-operation tools. The required `operation` field in the tool's schema routes to the correct handler. This fixes silent failures in n8n queue-mode MCP Trigger execution where the worker could not identify which sub-tool to invoke.
- **AI Tools — helper operations folded into unified tool (⚠️ breaking):** `describeFields` and `listPicklistValues` are now operations within the unified `autotask_<resource>` tool rather than separately-named tools (`autotask_<resource>_describeFields` / `autotask_<resource>_listPicklistValues`). They are always available regardless of the configured operations list. Update any hardcoded tool name references in MCP tool lists or saved workflows.
- **AI Tools — raw Zod schemas replace JSON schema normalisation:** Tool schemas are now passed as raw Zod instances to `DynamicStructuredTool`, fixing MCP Trigger's `schema.parseAsync()` path which previously silently failed when receiving a plain JSON object. `schema-normalizer.ts` has been removed.
- **AI Tools — `runtime.ts` for `instanceof` compatibility:** `DynamicStructuredTool` and Zod are now resolved from n8n's module tree via `createRequire`, anchored to `@langchain/classic/agents`. This ensures `instanceof` checks for both classes pass across bundled module copies in all n8n versions.

### Fixed

- **AI Tools — `operation` field leaked into API request bodies:** The `operation` parameter is now included in `N8N_METADATA_FIELDS` and stripped before routing to the executor. Previously, `operation: "create"` could reach API request bodies via the `execute()` code path.
- **AI Tools — `get` null response causes LLM hallucination:** A null/empty guard is now applied to `get` results. When the API returns HTTP 200 with a null or empty body (instead of 404), the tool returns a structured `ENTITY_NOT_FOUND` error rather than `{ result: null }`, which the LLM would otherwise interpret as success.
- **AI Tools — filtered `getMany` empty results trigger data fabrication:** When `getMany` with filters returns zero records, the tool now returns a structured `NO_RESULTS_FOUND` error with the filters used as context. Unfiltered empty results continue to return `{ results: [], count: 0 }`.

## [2.2.1] - 2026-03-09

### Fixed

- **Package — install fails with "Cannot find module @langchain/core/tools.cjs" (critical):** The top-level `import { DynamicStructuredTool } from '@langchain/core/tools'` and `import { toJsonSchema } from '@langchain/core/utils/json_schema'` compiled to synchronous `require()` calls that ran at package load time. In some n8n environments the resolved `@langchain/core` is ESM-only (no `.cjs` files), causing an immediate "Cannot find module" error that prevented the entire package — including the standard Autotask node — from loading. All three `@langchain/core` imports are now `import type` (type-only, no runtime require). The runtime values are acquired via lazy `require()` calls inside `supplyData()` / `buildHelperTools()` / `normaliseToolInputSchema()`, so they only execute when the AI Tools node is actually invoked by an agent, at which point n8n's CJS-compatible copy is used.
- **AI Tools — "Test step" in editor produces confusing errors:** `execute()` now returns a friendly stub (`"This is an AI Tool node. Connect it to an AI Agent node to use it."`) when no `tool` field is present in the input, instead of falling back to the first configured operation and likely throwing a missing-ID error.
- **AI Tools — `getById` description missing ID prerequisite guard:** `buildGetDescription` now explicitly states *"ONLY call this when you already have a numeric ID — never pass a name or text"* and names `autotask_<resource>_getMany` as the prerequisite lookup step. Previously the description omitted this guard, risking the LLM passing names instead of IDs.
- **AI Tools — `update` description missing ID prerequisite:** `buildUpdateDescription` now includes *"PREREQUISITE: you need the numeric ID"* with an explicit getMany lookup hint before calling update. Previously omitted, risking update-by-name attempts.
- **AI Tools — `delete` description uses generic tool names:** `buildDeleteDescription` now references the exact tool names (`autotask_<resource>_getMany` / `autotask_<resource>_getById`) in the confirmation-before-deletion guidance instead of the generic "getMany or get".

## [2.2.0] - 2026-03-09

### Fixed

- **AI Tools — toolkit compatibility with older n8n versions:** `StructuredToolkit` is now resolved from `n8n-core` with a try/catch fallback to `@langchain/classic/agents` `Toolkit`. Previously, if `n8n-core` did not export `StructuredToolkit` (n8n < 2.9), the node would throw at startup or be treated as an unnamed tool, producing *"multiple tools with the same name: 'undefined'"* when more than one toolkit node was connected.
- **AI Tools — n8n metadata fields contaminating API requests:** Framework-injected fields (`sessionId`, `action`, `chatInput`, `root`, `tool`, `toolName`, `toolCallId`) are now stripped from tool call parameters before routing. These could previously reach create/update request bodies, causing silent API errors.
- **AI Tools — `NodeConnectionType` value import breaks on some n8n versions:** `NodeConnectionType` is now imported as `import type` and the outputs array uses the string literal `'ai_tool' as NodeConnectionType`, matching the pattern required when `NodeConnectionType` is type-only in the host's `n8n-workflow` build.

### Changed

- **AI Tools — `get` tool renamed to `getById` (⚠️ breaking for existing workflows):** The `get` operation tool is now named `autotask_<resource>_getById` (e.g. `autotask_contact_getById`) instead of `autotask_<resource>_get`. This makes it unambiguous to the LLM that a numeric ID is required. A silent backward-compat alias (`autotask_<resource>_get`) is registered so existing workflows continue to function — it is intentionally undescribed so the LLM will not use it. **This alias will be removed in v3.0.0; update any hardcoded tool name references before then.**

## [2.1.2] - 2026-02-25

### Fixed

- **Trigger — webhook name exceeds 50-character API limit:** For entity types with long names (e.g. `ConfigurationItems`), the constructed webhook name could reach 53 characters, causing Autotask's API to reject activation with *"name must be less than or equal to 50 characters"*. The name is now capped at 50 characters via `.slice(0, 50)`. The stale-webhook cleanup prefix is unaffected — it is at most 45 characters for the longest entity type and always fits within the stored truncated name, so `beginsWith` cleanup continues to work correctly.

## [2.1.1] - 2026-02-20

### Fixed

- **Label resolution — ambiguous substring fallback causes wrong picklist/reference value selection (Issue #43):** When a user-supplied label did not exactly match a candidate (e.g. supplying `"Place Order"` when the stored label is `"4-Place Order"`), the previous `.includes()` fallback returned the first label containing the search string as a substring — which could be an entirely different option such as `"Place Order Waiting Payment"`. The fallback is now uniqueness-gated: a substring match is only accepted when exactly one candidate matches. If multiple candidates match, a descriptive warning is emitted listing the conflicting labels, and the field is left unresolved so the user can supply a more specific label. This fix applies to both picklist and reference field resolution.

## [2.1.0] - 2026-02-20

### Fixed

- **Company: Search by Domain — Limit field description and default:** Corrected the `Limit` field default from `50` to `25` to match `DEFAULT_DOMAIN_LIMIT` and the execute fallback. Updated the description to clarify that the limit controls the size of the embedded `results` array in the returned object, not the number of n8n output items.

### Changed

- **Remove `preinstall` lifecycle hook:** Dropped `"preinstall": "npx only-allow pnpm"` from `package.json`. The hook was intended to enforce pnpm usage in this repo but shipped in the published tarball, causing unnecessary latency or failures in restricted-network consumer environments where pnpm is not pre-resolved via npx.
- **Remove unused runtime dependencies:** Removed `chalk`, `pino`, and `pino-pretty` from `dependencies`. None of these packages were imported anywhere in the codebase; their presence added installation weight without benefit.
- **Bump `keyv` and `keyv-file`:** Updated `keyv` from `5.2.3` to `^5.6.0` and `keyv-file` from `5.1.1` to `^5.3.3`, picking up minor/patch improvements and switching from exact pins to caret specifiers to allow future patch updates.

## [2.0.7] - 2026-02-20

### Added

- **Company: Search by Domain — selectColumns / field selection support:** The `searchByDomain` operation now supports the same field-selection controls as `get` and `getMany`.
  - **Manual node:** A **Select Columns** multi-select dropdown (identical to the one on Get / Get Many) is now shown for the Search by Domain operation. Leave it empty to return all company fields; select specific columns to limit the response.
  - **Default behaviour — full entity returned:** Previously, each result contained only `id`, `companyName`, `matchedField`, `matchedValue`, and a single `website` convenience field. The default now returns the complete company entity (all fields), matching what a Get by ID would return.  `matchedField` and `matchedValue` are still always appended to each result as search metadata.
  - **AI Tool:** The `autotask_company_searchByDomain` tool schema gains a `fields` parameter (comma-separated field names) with the same semantics as `get`/`getMany`. Supplied field names are validated against the entity's field list before execution, returning a clear error with valid examples if an unknown field is specified. The tool description is updated to document this capability.

## [2.0.6] - 2026-02-19

### Fixed

- **Trigger — stale webhook detection & cleanup (Issue #27):** When a workflow is deactivated without a clean webhook deletion (network timeout, n8n crash, tunnel change), the next activation could silently reuse a webhook pointing to the wrong URL, or create a duplicate alongside the orphaned one. Two self-healing mechanisms are now in place:
  - **URL-mismatch detection in `checkExists()`:** After fetching the stored webhook from Autotask, the stored `webhookUrl` is compared against the node's current URL. If they differ, the stale webhook is deleted, static data is cleared, and `create()` is invoked to register a fresh webhook.
  - **Stale-webhook query in `create()`:** Before creating a new webhook, the node queries Autotask for any existing webhooks whose name matches the node-specific prefix (`n8n-{entityType}-{eventTypeCode}-{workflowId8}-{nodeId8}-`). Any matches are deleted before the new webhook is created. Query failure is non-fatal — creation proceeds regardless.
  - **Webhook naming now includes node ID:** The webhook name format is updated to `n8n-{entityType}-{eventTypeCode}-{workflowId8}-{nodeId8}-{timestamp}`, making it unique per node and preventing false-positive cleanup when two trigger nodes in the same workflow watch the same entity and events.

## [2.0.5] - 2026-02-19

### Fixed

- **Ticket / Ticket Note / Time Entry attachments — uploaded file corrupt or 1 KB:** `binaryItem.data` was used directly as the base64 payload, which is unreliable when n8n is configured with filesystem or S3 binary data storage (the field is empty or a storage reference in those modes). All three attachment `create` operations now use `this.helpers.getBinaryDataBuffer()` to retrieve the actual bytes, then convert to base64. The returned attachment `id` was also always `undefined` due to an incorrect response-type cast; corrected to `response.item.itemId`.

## [2.0.4] - 2026-02-17

### Fixed

- **Inactive contact/resource retry — new Autotask error format not recognised:** Changes to cover additional edge cases.

## [2.0.3] - 2026-02-17

### Fixed

- **Inactive contact/resource retry — new Autotask error format not recognised:** The inactive-entity retry mechanism (`withInactiveRefRetry`) failed silently when Autotask returned the newer error format `Reference value on field: contactID of type: Contact does not exist or is invalid.` instead of the previously observed `contactID: Value 12345 does not exist or is invalid`. The unified regex now handles both formats. Because the newer format omits the entity ID from the message, the request body (`fieldValues`) is now threaded through to all call sites so the ID can be resolved from the payload. Affected operations: create, update, contact move, work reassignment, and configuration item move.

## [2.0.2] - 2026-02-16

### Fixed

- **Get Many Advanced / Get Entity Info / Get Field Info — "Entity type not found in metadata":** `buildResourceToContextMap` was storing the `resourceKey` (e.g. `"configurationItems"`) as `entityType` instead of `entity.name` (e.g. `"ConfigurationItem"`). Because `getEntityMetadata` matches by name, any entity whose `resourceKey` differs from its camelCase name — including Configuration Items, Configuration Item Categories, Ticket Categories, Ticket Secondary Resources, and others — would throw `Invalid entity type: <resourceKey>. Entity type not found in metadata` for all three common operations. Regular Get Many was unaffected as it routes directly to a dedicated executor that never resolves entity types at runtime.


## [2.0.1] - 2026-02-16

### Changed

- **Impersonation on standard writes:** Added `Impersonation Resource ID` and `Proceed Without Impersonation If Denied` options to supported resources for standard create/update operations via the shared base operation path. Impersonation is off by default (blank ID), and strict mode is default (`Proceed Without Impersonation If Denied` defaults to off) for these standard write operations. AI Tools create/update schemas and descriptions now expose the same impersonation controls where supported.
- **Resource: Transfer Ownership:** Consolidated project/task options. Removed standalone "Include Tasks" and "Include Task Secondary Resources" toggles; tasks and task secondary resources are now controlled only via **Include Projects** and **Project Reassign Mode** (lead, tasks, and task secondary resources within projects). Added description to Include Projects. AI Tools transfer ownership schema updated to match.
- **Ticket Change Request Approval & Service Level Agreement Result:** Aligned with TicketNotes execution model. Removed dual-scope exception plumbing; both resources now use base operation classes for reads and common ops use root endpoints only. Ticket ID is required only for create/delete on Ticket Change Request Approval; Service Level Agreement ID parameter removed from Service Level Agreement Result.
- **AI Tools (Autotask AI Tools node):** Improved usability for date/time and recency:
  - Tool descriptions that reference date or time now include the **current UTC date-time** when tools were loaded, so the AI uses the real "now" instead of assuming its training cutoff. Applies to getMany, getPosted, getUnposted, count, create, and update operations.
  - **Recency vs since/until** behaviour is now explicit in both descriptions and schema: use **either** recency **or** since/until, not both; when since or until is set, recency is ignored (since/until take precedence). Preset windows (e.g. `last_7d`, `last_30d`) are for simple "last N days" queries; use since/until only for an explicit UTC range.
  - **Custom recency:** `recency` now accepts **last_Nd** with N from 1 to 365 (e.g. `last_5d`, `last_45d`) in addition to presets, so the AI can limit how far back to look and reduce result size.
  - Schema parameter descriptions for `recency`, `since`, and `until` direct the AI to use the current UTC reference from the tool description when interpreting dates.

### Fixed

- **Contact: Move to Company — note attachment copy silently skipped:** Attachment download response was cast as `{ items[] }` instead of the correct `{ item }` shape returned by single-entity GET endpoints; every note attachment was silently skipped regardless of options.
- **Contact: Move to Company — company notes query not scoped to source company:** `CompanyNotes/query/` was filtered only by `contactID`, pulling notes linked to that contact from any company in the tenant. Query now also filters by `companyID` of the source company. Dry-run note count query had the same missing scope and now uses the same compound filter.
- **Contact: Move to Company — audit note title:** Changed from "Contact Copied" to "Contact Transferred" on both source and destination audit notes.
- **Resource: Transfer Ownership — task secondary resources over-included:** When tasks were being transferred but none matched the configured filters, the secondary-resource filter short-circuited to include all task secondary resources for the source. Filter now correctly returns no rows when `includeTasks` is true but the task query is empty.
- **AI Tools — `dryRun` parameter ignored for move/transfer operations:** `dryRun` was hardcoded to `false` in the tool executor, so AI-supplied `dryRun: true` for `moveConfigurationItem` and `transferOwnership` silently executed the operation instead of returning a preview.
- **AI Tools — `proceedWithoutImpersonationIfDenied` default documented as `false` in create/update schemas:** Schema descriptions now consistently state `Default true`, matching the move and transfer operation schemas.
- **Ticket Change Request Approval — Ticket ID field not enforced in UI:** `ticketID` field was not marked `required: true`; the UI would allow submission without it, deferring the error to runtime.
- **Removed debug `console.log` from Ticket `getMany`** that logged filter details to stdout on every execution.
- **Date/time conversion direction reversed:** `convertValueToUTC` was converting UTC→local instead of local→UTC; outbound dates were offset in the wrong direction.
- **`||` masking `false`/`0` in UDF field mapping:** 10 boolean/numeric defaults in `mapUdfField` used `||` instead of `??`; fields with legitimate `false` or `0` values were silently overwritten.
- **AI Tools — case-insensitive filter operator rejected camelCase:** `mapFilterOp` lowered input but compared against original-case keys; `beginsWith`, `endsWith` etc. were invalid.
- **AI Tools — `exist`/`notExist` filters unusable:** Filter builder required a value for all operators; null-check operators now omit value.
- **AI Tools — count schema missing time parameters:** `recency`, `since`, `until` were absent from count operations; the AI could not count records in a time range.
- **Field validator never detected errors:** `validateFields` was synchronous; `await` on the returned Promise always evaluated truthy.
- **IncludeFields lost base fields:** `filter()` returned a new array, discarding fields pushed to the original reference inside the callback.
- **Webhook HMAC signature timing attack:** Replaced `===` string comparisons with `crypto.timingSafeEqual` at all three verification points.
- **Webhook 500 on mismatched entity/event type:** Threw `NodeOperationError` on non-matching events, causing Autotask retry storms; now returns empty workflow data.
- **Ticket Secondary Resource — missing `ticketID` for create/delete:** Parent endpoint requires ticket ID but the UI did not expose the field.
- **Malformed `continueOnFail` error objects in 9 resources:** `{ error: ..., json: {} }` placed the message outside `json`; n8n silently dropped it.
- **Webhook URL missing `/` separator:** Entity info URLs rendered as `/TicketsentityInformation/fields` instead of `/Tickets/entityInformation/fields`.
- **`REQUIRED_UPDATE_ID_FIELDS` key `'Charge'` matched no entity:** Changed to `'ProjectCharge'` to match the actual entity name.
- **Common operation fell through to resource switch:** Zero-result common ops continued into the resource-specific handler instead of returning.
- **DateTimeWrapper dropped time from zero-millisecond datetimes:** `10:30:00.000` was formatted as date-only; now checks all time components for midnight.
- **`includeInactive=true` sent invalid `eq null` filter:** Webhook resource query now sends an empty filter array when including inactive resources.
- **UDF flatten overwrote standard properties:** UDFs named `id`, `status` etc. now get a `udf_` prefix to avoid collisions.
- **GetManyAdvanced overwrote user IncludeFields:** `execute()` unconditionally reset IncludeFields already set by the user's advanced filter JSON.
- **Missing `await` on `processResponseDates` in create/update:** Response dates were never converted; the variable held a Promise instead of the result.
- **Contracts default operation was `create`:** Changed to `get`, consistent with all other resources.


## [2.0.0] - 2026-02-15

### Added

- **Autotask AI Tools**: Exposed `autotask_<resource>_describeFields` and `autotask_<resource>_listPicklistValues` tools in the main toolkit. The AI Agent can now find field names and picklist values without switching nodes.
- **Company: Search by Domain**: New operation to find companies by website or domain, available on both the main node and AI Tools. Accepts a domain or URL (normalises input), operator (eq, contains, beginsWith, endsWith), limit, and an option to search contact email addresses if no company is matched. Returns the most common company from matched contacts.
- **Ticket Category**: New resource with Get, Get Many, Update, and Count for managing ticket categories (defines groupings, display colours, default field values). Available in AI Tools.
- **Ticket Category Field Default**: New read-only child resource of Ticket Category supporting Get, Get Many, and Count to query default field values linked to categories. In AI Tools.
- **Ticket Change Request Approval**: New resource for ticket change request approvals. Supports root and ticket-child endpoints for Get, Get Many, Count, Create, and Delete. Available in AI Tools.
- **Ticket Secondary Resource**: New Ticket child resource with Get, Get Many, Count, Create, and Delete for managing secondary resource assignments. Available in AI Tools.
- **Project Task Secondary Resources**: New Task child resource with Get, Get Many, Count, Create, and Delete for managing secondary resource assignments on project tasks. Available in AI Tools.
- **Service Level Agreement Result**: New read-only resource for SLA results. Supports root and Service Level Agreement child scopes with Get, Get Many, and Count. In AI Tools.
- **Contact: Move to Company**: New operation to clone a contact to another company (all writable fields and UDFs), optionally copy CompanyNotes (with attachments) and ContactGroup memberships, leave configurable audit notes (links to source/destination contacts), and deactivate the source contact.
- **Ticket: SLA Health Check**: New operation combining Ticket and SLA Result data. Accepts ticket ID or number, returns milestone timings and hour-based health fields for first response, resolution plan, and resolution. Supports "Add Picklist Labels" and "Add Reference Labels". Available in AI Tools.
- **Configuration Item: Move Configuration Item**: New operation to clone a configuration item to another company, with options to copy UDFs, attachments, notes, and note attachments. Detects writable fields from the API. Supports dry runs, masking and oversize policies, partial-failure strategy, custom audit note templates (including deep links), source deactivation checks, and structured migration summary. Available in both the main node and AI Tools.
- **Impersonation for move operations**: Option to set Impersonation Resource ID for Contact Move to Company and Configuration Item Move Configuration Item. Records created during the move (contact, CI, notes, attachments) will be attributed to the specified resource via the `ImpersonationResourceId` header. Supported in both the main node UI and in AI Tools for `configurationItems.moveConfigurationItem`.
- **Appointment**: New resource with Get, Get Many, Count, Create, Update, and Delete for managing appointments (scheduled calendar work assigned to resources). Available in the main Autotask node.
- **Resource: Transfer Ownership**: New operation to transfer ownership and assignments from a source resource to a receiving resource. Supports companies, opportunities, tickets, tasks, projects, task secondary resources, service call ticket/task resource assignments, and appointments. Includes dry run, due-window presets (today through 30 days or custom), status filtering (default: exclude terminal statuses; optional allowlists), optional audit notes with template placeholders, and optional impersonation. Available in both the main node and AI Tools.

### Improved

- **UI performance**: Reduced duplicate node description properties, shrinking payload from 664.5 KB/1,335 properties to 219.9 KB/290 properties (67% smaller). Fixes UI freezes (10–30+ seconds) when editing Autotask nodes (see issue #22).
- **Inactive entity handling**: Centralised temporary activation pattern in `CreateOperation` and `UpdateOperation` base classes. Now, when a create or update fails due to a reference field (such as `contactID` or `createdByPersonID`) pointing to an inactive contact or resource, the node automatically activates the entity, retries, and then deactivates it. Previously, this was only applied to Company Notes; it now covers all entities. The individual `companyNoteInactiveContact` helper has been replaced with the shared `inactive-entity-activation` helper.


## [1.8.3] - 2026-02-14

### Fixed

- **Autotask AI Tools** — Fixed `ERR_INVALID_URL` crash by adding an `execute()` method so n8n 2.8+ no longer falls through to the declarative RoutingNode test path (which has no URL config).


## [1.8.2] - 2026-02-13

### Fixed

- **Autotask AI Tools** — Added URL validation and clearer `ERR_INVALID_URL` diagnostics when used as an AI Agent tool.


## [1.8.1] - 2026-02-13

### Fixed

- **Autotask AI Tools** — Fixed AI Agent crash (`Cannot set properties of undefined (setting 'strict')`) by returning tools via n8n-core's `StructuredToolkit` instead of a custom toolkit class, aligning with n8n's MCP Client Tool pattern.


## [1.8.0] - 2026-02-13

### Added
- **Autotask AI Tools node** — New `AutotaskAiTools` node that exposes Autotask operations as individual AI tools for n8n's AI Agent, following MCP-style patterns with one tool per operation. Each resource can expose multiple focused tools (get, getMany, create, update, delete, count) with resource-specific schemas.


## [1.7.0] - 2026-02-11

### Added
- Per-operation API response caching for Autotask `resource` get/whoAmI/getMany operations with configurable TTL, using versioned keys and centralised helper/registry for easy extension.
- Automatic retry handling for Autotask 429 (Too Many Requests) responses using exponential backoff with jitter and a 5 minute total wait cap, with clear error messaging when the limit is still exceeded after retries.

### Improved
- Rate limit tracking initialisation is now available from the main Autotask node via `initializeRateTracker`, with a cooldown guard to avoid excessive calls to the Autotask `ThresholdInformation` endpoint when many workflows execute concurrently.


## [1.6.2] - 2026-02-06

### Fixed

- **Company Notes (inactive contact)** — Temporary contact activation PATCH now sends `isActive` as integer `1`/`0` instead of boolean `true`/`false`, matching the Autotask Contacts entity field type and fixing 500 "Unexpected character encountered while parsing value: t" errors.

## [1.6.1] - 2026-02-06

### Fixed

- **Company Notes (inactive contact)** — Temporary contact activation/deactivation now PATCHes the Contact collection endpoint `Companies/{companyID}/Contacts/` with the contact id in the body. The Autotask API does not support PATCH on the individual contact URL (`Companies/{id}/Contacts/{contactId}/`), which was causing 405 Method Not Allowed.


## [1.6.0] - 2026-02-06

### Added

- **Company Notes: Automatic inactive contact handling** — When creating or updating a Company Note with a `contactID` that references an inactive contact, the node now automatically activates the contact, performs the operation, then deactivates the contact again. Previously the Autotask API would reject the request with "Reference value on field: contactID of type: Contact does not exist or is invalid". If the contact is already active and the error still occurs, the original error is re-thrown unchanged.


## [1.5.1] - 2026-02-06

### Fixed

- Fixed double trailing slash in child entity API URLs (e.g. `Companies/{id}/Notes//`) caused by `processEndpointPath` being called twice — once in URL builders and again in `autotaskApiRequest`. Made the function idempotent by stripping trailing slashes before processing.
- Fixed `body.id` sent as string `'0'` instead of number `0` for child entity create operations, matching the Autotask API's `long` datatype expectation.


## [1.5.0] - 2026-02-06

### Added

- **Time Entry: Get Posted / Get Unposted** — New operations on the Time Entry resource to list labour entries by posting status. Cross-references TimeEntries with BillingItems (type Labour and Labour Adjustment; Autotask has no posted-status field on TimeEntry). Reuses Get All, Max Records, picklist labels, reference labels, select columns, and flatten UDFs options.
- **Zone: Australia / New Zealand (Sydney — from 11 Mar 2026)** — New zone option (API: webservices29.autotask.net) for the Autotask AUS/NZ datacentre migration (11 March 2026). For this zone: User interface ww29.autotask.net; Data Warehouse reports29.autotask.net; Performance Analytics workbooks workbooks29.autotask.net.


## [1.4.5] - 2026-02-02

### Fixed

- Corrected AI Helper `describeResource` to use Autotask field metadata for `isPickList`, so boolean fields like `isBillableToCompany` are no longer treated as picklists, preventing spurious \"Only picklist fields have selectable values\" errors during create/update operations.


## [1.4.4] - 2026-01-26

### Fixed

- Fixed AI Helper `describeResource` to include all dependent picklist values (e.g., `subIssueType`) with their `parentValue` mappings, regardless of picklist size. Previously, picklists with >50 values were excluded. Also updated `listPicklistValues` and internal picklist helpers to preserve `parentValue` throughout the codebase, enabling proper parent-child relationships like Issue Type to Sub Issue Type.
- Fixed circular dependency causing node loading to hang by using dynamic imports for `FieldProcessor` in `output-mode.ts` and lazy initialisation of `GetManyOperation` in `value-helper.ts`, breaking the dependency cycle between output-mode → field-processor → entity-values → value-helper → get-many → output-mode.


## [1.4.3] - 2026-01-21

### Fixed
- Removed the `Values to Send` resource mapper UI from the Ticket History `getMany` operation, as TicketHistory queries are restricted by the Autotask API to a single `ticketID equals` filter and do not support selecting fields to send.

## [1.4.2] - 2026-01-21

### Fixed
- Restored User Defined Field (UDF) support in resource mapper and \"Select Columns Names or IDs\" for all UDF-capable entities (including Companies, Contacts, Contracts, Opportunities, Projects, Services, Subscriptions and Tasks) by correctly flagging them with `hasUserDefinedFields` in entity metadata, while keeping UDF loading disabled for entities that do not support it (e.g. attachment resources).


## [1.4.1] - 2026-01-10

### Added

- Added Time Entry Attachment resource for managing files attached to time entries.
- Time Entry Attachment resource supports: create, get many, count, download, and delete operations.


## [1.4.0] - 2026-01-10

### Added

- Added Ticket Attachment resource for managing files attached directly to tickets.
- Added Ticket Note Attachment resource for managing files attached to ticket notes.
- Both attachment resources support: create, get many, count, download, and delete operations.
- Shared attachment helper utilities (`helpers/attachment.ts`) for future attachment types.
- File size validation (6MB limit) for attachment uploads.

### Fixed

- Fixed multiple helpers attempting to fetch User Defined Fields (UDFs) for entities that don't support them (e.g. TicketAttachment), causing 404 errors. Affected: resource mapper, filter builder, AI helper, field processor, and body builder. All now check entity metadata before fetching UDF fields.

## [1.3.1] - 2025-12-14

### Fixed

- Fixed dry run option appearing for read operations (get, getMany, getManyAdvanced). Dry run now only appears for write operations (create, update, delete) as intended. Removed dry run handling from read operation classes since the option is not available for these operations.

## [1.3.0] - 2025-12-14

### Added

- Added dry run option for all write operations (create, update, delete). When enabled, returns a preview of the request that would be sent without making any changes to Autotask. Useful for testing and validation.

## [1.2.6] - 2025-11-23

### Fixed

- Fixed double throttling bug in rate limiter that was applying delays twice
- Fixed counter decrement logic in threshold sync to correctly track API usage
- Consolidated counter reset logic to prevent race conditions
- Improved rate limit handling: now waits for rolling 60-minute window to reset instead of just 5 seconds
- Added maximum wait timeout (10 minutes) to prevent infinite blocking when at rate limit
- Added specific error handling for 429 Too Many Requests responses with clear error messages

### Improved

- Enhanced rate limiting with proper wait-until-reset logic when limit is reached
- Added automatic API threshold syncing every 30 seconds during rate limit waits
- Improved documentation for rate limiting, thread limiting, and threshold information bypass


## [1.2.5] - 2025-11-06

### Fixed

- Prevent parent ID lookups failing in auto-map mode by passing parent ID directly from validated payload to URL builder for child entity create/update operations (affects Contact and other child resources). Also enforces strict typing on the override value.

## [1.2.4] - 2025-11-06

### Fixed

- Auto-map mode now uses incoming item data and ignores node mappings
- Includes all schema-matching fields (even if marked removed in UI)
- `bodyJson` still overrides auto-mapped values

## [1.2.3] - 2025-10-16

### Fixed

- Improved error logging to sanitise sensitive information in debug output



## [1.2.2] - 2025-10-04

### Fixed

- **Field mapping expression errors now properly fail the node**: Previously, expression errors (e.g., referencing unexecuted nodes) were silently caught and only logged to console, causing the node to show success in UI while sending empty API requests. Expression errors now correctly propagate to the UI with helpful error messages.

## [1.2.1] - 2025-09-16

### Added
- Added support for ContractExclusionSets entity with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing reusable sets of roles and work types that are excluded from contracts
- Enhanced field processing for Contract entities by whitelisting contractPeriodType and exclusionContractID fields for create operations despite being marked read-only

## [1.2.0] - 2025-09-16

### Added
- Added support for TicketCharges entity as a child resource of Tickets with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations, where Update and Delete operations are only allowed when isBilled = false
- Added support for TicketChecklistItems entity as a child resource of Tickets with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing checklist items on Autotask tickets
- Added support for TicketChecklistLibraries entity as a child resource of Tickets with Create operation only, allowing all items from a checklist library to be added to a ticket (appends to existing checklist items)
- Added support for ChecklistLibraries entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing modular checklist components that can be applied to tickets or tasks
- Added support for ChecklistLibraryChecklistItems entity as a child resource of ChecklistLibraries with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing individual checklist items within checklist library templates
- Added support for ClassificationIcons entity as a read-only standalone resource with Get, GetMany, GetManyAdvanced, and Count operations for querying classification icons used in Autotask for categorizing and visually identifying different types of items
- Added support for Tags entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing ticket and article tags with unique label requirements and system tag protections
- Added support for TagGroups entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for organizing tags into categories with unique labels, display colors, and system group protections
- Added support for TagAliases entity as a child resource of Tags with Create, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing alternative names for tags to improve searchability with unique Tag ID/Alias combinations

## [1.1.0] - 2025-09-03

### Added
- **Enhanced AI Tool Effectiveness**: Major improvements to Tool and AI Helper resources for n8n AI node compatibility
  - **Static Tool Surface**: Added `TOOL_OPERATION_OPTIONS` with all 100+ resource-operation combinations for immediate AI enumeration
  - **Capability Discovery**: New `listCapabilities` operation in AI Helper for comprehensive API introspection
  - **Proactive Validation**: Automatic parameter validation for create/update operations with helpful error guidance
  - **Safety Gates**: Configurable restrictions with `allowWriteOperations`, `allowDryRunForWrites`, and `allowedResourcesJson`
  - **Enhanced Hints**: Proactive parameter hints pointing to appropriate AI Helper functions
  - **AI Resource Discoverability**: Removed `displayOptions.show.resource` gating for Tool and AI Helper resources

### Changed
- **BREAKING: Tool Resource**: Redesigned with simple string/JSON parameters for AI Node compatibility
- **Tool > Execute safety gating**: Centralised enforcement for:
  - `Allow Write Operations` (default false) blocks create/update/delete unless explicitly enabled
  - `Allow Dry Run for Writes` (default true) permits dry-run previews when writes are blocked
  - `Allowed Resources (JSON)` restricts execution to an allow-list (case-insensitive)
  - `Dry Run` returns structured previews without calling the API

### Fixed
- **Delete dry-run behaviour**: 
  - Tool > Execute now returns a structured delete preview when `dryRun` is enabled instead of executing the request
  - Base delete operation respects `dryRun` and no longer issues DELETE requests when enabled
- **AI Helper resource picklists**: Fixed AI Helper resource name fields to display as proper dropdown picklists instead of empty autocomplete inputs by changing field type from 'string' to 'options'
- **AI Helper List Picklist Values**: Enhanced operation with parameter validation, improved UDF field detection, better error handling with helpful messages, and enriched response metadata including pagination info and field details
- **Fixed AI parameter isolation**: Prevented AI-specific `selectColumnsJson` parameter from interfering with regular resource mapper picklist loading
- **Resource Mapper Manual Mode**: Fixed auto-population of fields in "map each column manually" mode across all resources

## [0.9.9] - 2025-09-01

### Added
- Added support for Billing items resources
 - Invoice special endpoints:
   - Get PDF: download invoice as a PDF (`InvoicePDF`)
   - Get Markup (HTML): retrieve invoice markup (`InvoiceMarkupHtml`)
   - Get Markup (XML): retrieve invoice markup (`InvoiceMarkupXML`)
   - Exposed as new operations on the Invoice resource; responses are returned as binary data with `fileName` and `contentType` for downstream use


## [0.9.8] - 2025-08-29

### Added
- Added support for Subscription and Subscription Periods resources


## [0.9.7] - 2025-08-24

### Changed
- Updated AI Helper and Tool resources to better align with AI Agent node operational requirements
- Removed AI centric inputs from all resoruces other than AI Helper and Tool resource


## [0.9.6] - 2025-08-17

### Added
- **AI Agent-Friendly Improvements**: Comprehensive enhancements for AI/tool-calling systems including:
  - **AI Helper Resource**: New `aiHelper` resource with `describeResource`, `listPicklistValues`, and `validateParameters` operations for runtime introspection
  - **JSON Parameter Fallbacks**: `bodyJson` and `selectColumnsJson` parameters to override UI mappings with structured JSON input
  - **Output Modes**: `rawIds`, `idsAndLabels`, `labelsOnly` options for token-efficient responses  
  - **Dry-Run Support**: Request preview functionality across all operations without API execution
  - **Dynamic Dependency Discovery**: Automatic entity relationship mapping and field dependency detection
  - **JSON Schema Validation**: Immediate feedback on malformed JSON parameters
  - **Enhanced Error Hints**: Structured error responses with actionable suggestions for AI self-correction
  - **Agent Playbook Documentation**: Comprehensive guide for AI agent integration and best practices
  - **Label-to-ID Resolution on Writes**: `bodyJson` can now accept picklist/reference labels; values are pre-flight resolved to IDs using introspection and lookups
  - **Reference Alias Tolerance**: Improved reference detection to accept common variants/typos (e.g. `resrouce`, `assignedresource`, `accountManager`, `account_manager`) and map them correctly

### Changed
- **Consistent Output Shaping**: Applied `outputMode` processing to create/update responses for consistency with read operations
- **Agent Hints (Read Ops)**: Expanded agent-friendly hints in read paths (e.g. empty/invalid responses) to aid self-correction

## [0.9.5] - 2025-08-11

### Changed
- Resolved merge conflicts and bumped version to 0.9.5. Preserved all changes from 0.9.3 and 0.9.4.

## [0.9.4] - 2025-08-11

### Fixed
- Fixed a bug where Assets (Configurtion items) Webhook errored with "Invalid entity type. Received InstalledProduct, expected ConfigurationItems."

## [0.9.3] - 2025-08-07

### Added
- Added support for CompanySiteConfigurations endpoint support for:
  - **Update**: Modify site configuration settings and user-defined fields for customer companies
  - **Get**: Retrieve individual site configuration by ID
  - **Get Many**: Query multiple site configurations with filtering support
  - **Count**: Count site configurations matching specific criteria
  - **Entity Info**: Access field definitions and metadata
  - Full User-Defined Fields (UDF) support with Protected Data Permissions (DPP) compliance
  - Parent-child relationship support with Companies entity

## [0.9.2] - 2025-07-31

### Fixed
- Fixed a bug where UDFs selected in the resource mapper for `Get Many` and `Count` operations were not being correctly identified, causing API errors.

## [0.9.1] - 2025-07-23

### Changed
- Increased maximum page count from 50 to 1000
- Refactored pagination to use iterative loops instead of recursion for large data sets.

### Fixed

## [0.9.0] - 2025-07-10

### Fixed
- Enhanced date/time handling in Search Filter's Build and Dynamic Build operation, building on v0.8.9 fix: now thoroughly converts input and output dates consistently between timezones using credentials' configured timezone, ensuring all dates sent to Autotask API are in UTC as required.

## [0.8.9] - 2025-07-10

### Fixed
- Prevented double UTC conversion for date values in the Search Filter's Dynamic Build operation.

## [0.8.8] - 2025-07-05

### Changed
- Performance improvement for getMany operations: reference and picklist enrichment now fetches only required entities, not all.

## [0.8.7] - 2025-07-05
### Fixed
- Resolved an issue where reference fields were exclusively enriched from active records; now supports enrichment from inactive records when required. Additionally, ensured that display fields for inactive reference records are properly retrieved for accurate label generation (e.g., resource names instead of "Resource #ID") by ensuring correct ID type handling during lookup. Picklists continue to be populated from active records only.

## [0.8.5] - 2025-07-01
### Changed
- Performance: Continued UI-performance tuning for large workflows – the "Select Columns" dropdown now renders **only** the fields you pick (`showOnlySelected`) and includes in-dropdown search capabilities.  This further reduces DOM load and improves NDV responsiveness when hundreds of Autotask fields are available.

## [0.8.4] - 2025-06-30
### Changed
- Performance: Introduced provisional in-memory memoisation and pick-list trimming for the "Select Columns" dropdown as part of ongoing UI-performance tuning for larger workflows.

## [0.8.3] - 2025-06-29

### Added
- Added support for `Countries` entity to enable `CountryID` reference field enrichment.

### Changed
- Modified the display name format for several reference fields to provide a cleaner and more consistent UI:
  - **Resource**: Changed from `FirstName LastName [Email] [ID]` to `FirstName LastName`.
  - **Contact**: Changed from `FirstName LastName [Email]` to `FirstName LastName`.
  - **Ticket**: Changed from `TicketNumber - Title` to `Title [TicketNumber]`.

## [0.8.2] - 2025-05-24

### Fixed
- Fixed ID validation for get and delete operations: IDs of 0 are now accepted as valid values

## [0.8.1] - 2025-05-10

### Added
- Added support for ServiceCallTasks, ServiceCallTickets, ServiceCallTaskResources and ServiceCallTicketResources entities

## [0.8.0] - 2025-05-09

### Added
- Added support for Quotes, QuoteItems, QuoteLocations and QuoteTemplates entities

## [0.7.4] - 2025-04-21

### Added
- Added structured metadata to nodes for better categorisation

## [0.7.3] - 2025-04-18

### Fixed
- Fixed issue with custom URL not being used for pagination requests:
  - Modified request handling to use custom URL consistently for all API calls
  - Fixed pagination URLs to work properly with proxy/custom URL configurations
  - Ensures all requests in a paginated sequence use the same base URL

## [0.7.2] - 2025-04-17

### Fixed
- Updated documentation in README:
  - Corrected Advanced Example for Complex Filtering with Get Many Advanced operation

## [0.7.1] - 2025-04-17

### Changed
- Updated "Other (Use Zone Information API)" option in credentials to "Other (Custom URL)":
  - Modified the credential option to better reflect its actual functionality
  - The custom URL is now used directly without any zone lookup

## [0.7.0] - 2025-04-14

### Fixed
- Improved error handling to display specific API error messages in n8n UI:
  - Enhanced error extraction from API responses for all status codes

## [0.6.9] - 2025-04-13

### Added
- Enhanced Search Filter resource with new "Dynamic Build" operation:
  - Added entity-driven field selection workflow distinct from standard "Build" operation
  - Implemented dynamic field loading based on entity selection
  - Added UDF field support with clear type indicators

## [0.6.8] - 2025-04-12

### Fixed
- Improved API error handling:
  - Enhanced error messages to include complete API error context
  - Fixed issue where original API error details weren't displayed to users

## [0.6.7] - 2025-04-12

### Fixed
- Fixed UI field reloading when resource or operation changes:
  - Added loadOptionsDependsOn property to "Select Columns" option
  - Added loadOptionsDependsOn to "Add Picklist Labels" option
  - Added loadOptionsDependsOn to "Add Reference Labels" option
  - Added loadOptionsDependsOn to "Flatten User-Defined Fields" option
  - Added loadOptionsDependsOn to "Get All" (returnAll) option
  - Added loadOptionsDependsOn to "Max Records" option
  - Added loadOptionsDependsOn to Advanced Filter option
  - Ensures all fields properly refresh when resource or operation is changed

## [0.6.5] - 2025-04-11

### Added
- Added support for Roles entity
- Added support for ContractBillingRules entity
- Added support for ContractExclusionBillingCodes entity:
- Added support for ContractRoleCosts entity
- Added support for ContractExclusionRoles entity
- Added support for ContractExclusionSetExcludedRoles entity
- Added support for ContractExclusionSetExcludedWorkTypes entity
- Added support for ContractExclusionSets entity
- Added support for ContractRetainers entity
- Added support for ContractServiceAdjustments entity
- Added support for ContractServiceBundleAdjustments entity
- Added support for ContractServiceBundles entity
- Added support for ContractServiceBundleUnits entity
- Added support for ContractTicketPurchases entity
- Added support for DomainRegistrars entity
- Added support for Invoices entity
- Added support for ProductVendors entity
- Added support for NotificationHistory entity
- Added support for ContactGroups entity
- Added support for ContactGroupContacts entity


### Fixed
- Fixed issue with reference type fields not populating in resource mapper:
  - Modified FieldProcessor to properly handle reference field loading in resource mapper context
  - Ensures reference picklists are populated consistently like regular picklists
  - Improves field selection experience by showing all available reference values
  - Previously, reference fields appeared empty while regular picklists worked fine

## [0.6.4] - 2025-04-11

### Added
- Added support for ResourceRole entity:
  - Enables retrieval of department/role relationships, service desk queues, and service desk roles

## [0.6.3] - 2025-04-09

### Fixed
- Fixed DateTime handling in search filter operations:
  - Fixed issue where DateTime values with time components were being truncated to just date
  - Modified search filter builder to preserve time information when present in input
  - Now correctly formats DateTime values with full time components in filter conditions
  - Ensures DateTime filters with specific times (e.g., 2025-04-08T19:18:19.738-04:00) are processed correctly

## [0.6.2] - 2025-04-06

### Fixed
- Fixed webhook signature verification failing with non-English characters:
  - Enhanced Unicode character handling to properly escape all non-ASCII characters
  - Fixed webhook verification issues when payloads contain accented characters (é, è, etc.)
  - Added proper encoding of all Unicode characters to match Autotask's escaping format
  - Resolved signature validation failures with French and other non-English text content
  - Improved compatibility with international character sets in all webhook operations

## [0.6.1] - 2025-04-02

### Added
- Added support for Autotask API thread limiting with per-endpoint concurrency control
- Added warning notices about API limits in webhook configuration UI
- Improved webhook field and resource selection with API limit warnings

### Fixed
- Fixed thread tracking for API endpoints to respect Autotask's 3-thread limit per endpoint


## [0.5.9] - 2025-04-01

### Added
- Added API Threshold resource for checking API usage limits:
  - Added new 'API Threshold' resource with a single 'Get API Usage' operation
  - Provides information about current API usage, limits, and remaining requests
  - Returns usage statistics including:
    - Current usage count
    - Maximum threshold (limit)
    - Usage percentage
    - Usage level (Normal, Moderate, High, Critical)
    - Remaining available requests
    - Timeframe duration


## [0.5.8] - 2025-04-01

### Fixed
- Improved webhook creation error handling:
  - Added field/resource configuration retries (3 attempts with exponential backoff)
  - Fixed detection of field configuration failures
  - Implemented automatic cleanup of partial webhooks on failure
  - Enhanced error reporting and validation


## [0.5.7] - 2025-03-31

### Fixed
- Added version-aware caching to ensure cache invalidation on node updates


## [0.5.6] - 2025-03-30

### Fixed
- Fixed issue with webhook field configurations:
  - Resolved problem where fields selected in both Subscribed Fields and Always Display Fields were not configured correctly
  - Modified implementation to allow fields to have both isSubscribedField and isDisplayAlwaysField flags set to true
  - Updated field processing logic to handle fields that appear in both selection lists
  - Ensures all selected fields appear in the Autotask webhook configuration as expected
  - Improves consistency between n8n UI configuration and Autotask webhook settings

## [0.5.5] - 2025-03-29

### Fixed
- Fixed entity type handling in webhook processing:
  - Added missing entity type aliases for singular-to-plural mapping
  - Resolved "Invalid entity type. Received Ticket, expected Tickets" error
  - Added support for "Ticket", "Contact", "ConfigurationItem", and "TicketNote" to match their plural counterparts
  - Ensures consistent webhook handling across all entity types
  - Improves reliability for all webhook trigger operations

## [0.5.4] - 2025-03-28

### Added
- Added support for Ticket Webhook operations:
  - Added TicketWebhook entity and related entities to support webhook management
  - Implemented webhook resource operations for tickets:
    - Get webhook by ID
    - Get multiple webhooks
    - Delete webhooks
  - Added support for webhook field configuration and excluded resources
  - Follows the same pattern as other webhook-enabled entities (Company, Contact, etc.)
  - Enables real-time ticket event notifications through the AutotaskTrigger node

### Fixed
- Fixed issue with ticket webhook creation in AutotaskTrigger node
  - Resolved error "Invalid entity type. Received Ticket, expected Tickets"
  - Updated entity type validation to handle plural form correctly
  - Ensures webhook creation works consistently across all supported entities

## [0.5.3] - 2025-03-26

### Fixed
- Fixed issue with "Select Columns Names or IDs" option being ignored in get (get by ID) operations
  - Modified get operations to use query endpoint with ID filter when columns are selected
  - The fix ensures that column selection works properly across all get operations
  - This workaround addresses a limitation in the Autotask API where IncludeFields parameter is ignored in get-by-ID endpoint

## [0.5.2] - 2025-03-26

### Fixed
- Removed client-side filtering from all get operations when using IncludeFields parameter
  - Fixed issue where User Defined Fields (UDF) would not be properly returned in responses
  - Improved operation classes to rely solely on server-side filtering via API IncludeFields parameter
  - Optimised all get operations (Get, GetMany, GetManyAdvanced) for more reliable handling of UDF fields
  - Ensures all selected fields, including UDF fields, are properly included in API responses

### Added
- Added UDF flattening option for get operations
  - New "Flatten User-Defined Fields" toggle for get, getMany, and getManyAdvanced operations
  - When enabled, brings UDF fields up to the top level of each object for easier access
  - Makes UDFs directly accessible as top-level properties instead of being nested in the userDefinedFields array
  - Maintains original userDefinedFields array for backward compatibility

## [0.5.1] - 2025-03-25

### Added
- Added "Who Am I" operation to Resources entity
  - Retrieves the resource details of the API user specified in the node credentials
  - Extracts username from credentials email and queries matching resources
  - Supports standard options: Add Picklist Labels, Add Reference Labels, and Select Columns

## [0.5.0] - 2025-03-25

### Added
- Comprehensive webhook support:
  - Added AutotaskTrigger node for receiving webhook events
  - Added support for webhooks across all supported entities:
    - Company
    - Contact
    - Configuration Item
    - Ticket
    - Ticket Note
  - Added webhook resource operations for the supported entities:
    - Get webhook by ID
    - Get multiple webhooks
    - Delete webhooks
  - Implemented webhook field configuration for controlling payload contents
  - Added resource exclusion capabilities to filter webhook events
  - Added email notifications for webhook delivery failures
- Made resource descriptions more detailed with improved clarity and context

## [0.4.1] - 2025-03-21

### Added
- Added support for:
  - Surveys entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/SurveysEntity.htm)
  - SurveyResults entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/SurveyResultsEntity.htm)
  - ConfigurationItems entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm)
  - ConfigurationItemTypes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemTypesEntity.htm)
  - ConfigurationItemCategories entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemCategoriesEntity.htm)
  - ConfigurationItemNotes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemNotesEntity.htm)
  - ConfigurationItemRelatedItems entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemRelatedItemsEntity.htm)
  - ConfigurationItemDnsRecords entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemDnsRecordsEntity.htm)
  - ConfigurationItemBillingProductAssociations entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemBillingProductAssociationsEntity.htm)
  - ConfigurationItemCategoryUdfAssociations (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemCategoryUdfAssociationsEntity.htm)
  - ConfigurationItemSslSubjectAlternativeName (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemSslSubjectAlternativeNameEntity.htm)

## [0.4.0] - 2025-03-20

### Added
- Added support for ContractCharges entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractChargesEntity.htm)
- Added support for ContractMilestones entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractMilestonesEntity.htm)
- Added support for ContractNotes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractNotesEntity.htm)
- Added support for ContractServices entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractServicesEntity.htm)
- Added support for ContractServiceUnits entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractServiceUnitsEntity.htm)
- Added support for ContractBlocks entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractBlocksEntity.htm)
- Added support for ContractBlockHourFactors entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractBlockHourFactorsEntity.htm)
- Added support for ContractRates entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractRatesEntity.htm)
- Added support for Services entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ServicesEntity.htm)


## [0.3.4] - 2025-03-19

### Changed
- Updated README to include comprehensive documentation for all features
  - Added new section on reference field enrichment
  - Added new section on column selection
  - Added new example for using column selection and reference labels together
  - Added missing resources to the supported resources list
  - Improved documentation for performance optimisation

## [0.3.3] - 2025-03-18

### Added
- Added column selection for get operations
  - New "Select Columns" option for get, getMany, and getManyAdvanced operations
  - Allows selection of specific fields to return in the response
  - Uses the same field definitions as the resource mapper
  - Improves performance by reducing response payload size
- Added reference field enrichment for get operations
  - New "Add Reference Labels" option for get, getMany, and getManyAdvanced operations
  - Automatically adds "_label" fields with human-readable values for all standard picklist fields
  - Works just like picklists but for references to other entities
  - Provides friendly names instead of just IDs for related entities
- Added date value type to search filter resource
  - Enhanced filtering capabilities by allowing date-based queries
  - Compatible with various date formats including ISO 8601
  - Automatically converts date inputs to Autotask API format
  - Added date picker UI for improved user experience

### Fixed
- Fixed issue where "Add Picklist Labels" and "Add Reference Labels" options didn't work when "Select Columns" was used
  - Label fields (_label suffix) are now included when their base field is selected
  - Added additional logging for troubleshooting column selection issues
  - Improved field filtering logic to maintain relationships between fields
- Date values in search filters now properly respect timezone settings from credentials
  - Fixed inconsistency where search filter dates were not being converted from local timezone to UTC
  - All date operations now consistently use the configured timezone
- Fixed date conversion issue in getManyAdvanced operation
  - Resolved a problem where date fields weren't being converted correctly when picklist labels were added
  - Modified both getManyAdvanced and getMany operations to ensure date conversion always happens
