# Design: n8n-add-ai-tools Skill v2

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Full rewrite of skill.md + targeted template block rewrites in code-templates.md + reset of discoveries.md

---

## Background

The `n8n-add-ai-tools` skill is a 3-file system for adding production-ready AI Tools nodes to n8n community node packages:

- `skill.md` — workflow, architecture decisions, QA process
- `references/code-templates.md` — complete TypeScript templates
- `references/discoveries.md` — production learnings notebook

The v1 skill was built iteratively through production use and accumulated 11 structural issues that individually are manageable but collectively make the skill brittle, inconsistently safe, and harder to use outside the author's own environment. v2 addresses all 11 in a single cohesive rewrite.

---

## Requirements (11 items)

| # | Requirement | Category |
|---|---|---|
| 1 | Make self-contained — remove mandatory superpowers/feature-dev skill dependencies | Portability |
| 2 | Add top-level compatibility matrix | Correctness |
| 3 | Upgrade write-safety from toggle to three-layer gate | Safety |
| 4 | Add MCP-safe tool name validation to QA | Correctness |
| 5 | Split current n8n MCP metadata from future-ready MCP metadata | Forward-compat |
| 6 | Add stable result envelope with schemaVersion | Forward-compat |
| 7 | Harden runtime.ts anchor strategy with ordered candidates + diagnostics | Robustness |
| 8 | Promote all 6 active discoveries into core template rules | Safety/Correctness |
| 9 | Remove "scan helper skills first" from critical path | Portability |
| 10 | State that MCP queue-mode reliability requires infrastructure routing | Correctness |
| 11 | Remove implicit reliance on notebook-only rules for safety-critical behaviour | Safety |

---

## Decisions

### n8n Version Range (req 2)
`≥ 2.10.x`. Tested surface: n8n 2.10.0–2.10.4. LangChain catalog versions confirmed stable across this range.

### Runtime Anchor Candidates (req 7)
Ordered list based on n8n 2.10.x dependency tree analysis:
1. `@langchain/classic/agents` — primary; `@langchain/classic: 1.0.5` is a direct dep of `@n8n/nodes-langchain`, stable since n8n 2.4.x. Its `@langchain/core` peerDep resolves to n8n's hoisted `@langchain/core: 1.1.8`.
2. `langchain/agents` — secondary; `langchain: 1.2.3` is in the n8n catalog and also has `@langchain/core` as peerDep.
3. Fail-fast: emit diagnostic listing which candidates were tried and what error each produced. Never silently fall back to a community-node-bundled copy.

### Result Envelope (req 6)
Replace current per-operation shapes with a unified envelope. `schemaVersion: "1"`. Branch point: `success` boolean only.

```json
// get
{ "schemaVersion": "1", "success": true, "operation": "get", "resource": "ticket", "result": { ...entity } }

// getAll — note: "items" not "results"
{ "schemaVersion": "1", "success": true, "operation": "getAll", "resource": "ticket",
  "result": { "items": [...], "count": 3, "truncated": false } }

// create / update / delete
{ "schemaVersion": "1", "success": true, "operation": "create", "resource": "ticket",
  "result": { "id": 123, ...entity } }

// any error (including WRITE_OPERATION_BLOCKED)
{ "schemaVersion": "1", "success": false, "operation": "get", "resource": "ticket",
  "error": { "errorType": "ENTITY_NOT_FOUND", "message": "...", "nextAction": "..." } }
```

Rationale: wrapping preserves inner inconsistencies (`result.result`, `result.results`). Replacing gives a single `outputSchema`, clean `structuredContent` mirroring, and one LLM branch point.

Breaking change: `results` → `items` in getAll. Acceptable because skill controls all template code.

#### Envelope implementation contract

**Who wraps:** `error-formatter.ts` exposes two factory functions called at the call site in `tool-executor.ts`:
- `wrapSuccess(resource, operation, result)` → full success envelope
- `wrapError(resource, operation, errorType, message, nextAction, context?)` → full error envelope

The old flat `StructuredToolError` interface is retired. The old `formatXxx()` helpers are replaced by direct calls to `wrapError()` with named `errorType` constants. All `tool-executor.ts` return paths call `JSON.stringify(wrapSuccess(...))` or `JSON.stringify(wrapError(...))`.

**`resource` field:** All formatter calls in `tool-executor.ts` already receive `resource` as a parameter (it is extracted from `args` before the operation switch). `wrapSuccess` and `wrapError` both accept `resource` as their first argument — no interface changes needed elsewhere.

**`nextAction` location:** `nextAction` lives inside `error: { ... }`, not at the envelope top level. This is consistent across all error types including `WRITE_OPERATION_BLOCKED`.

**Write-blocked error shape:**
```json
{ "schemaVersion": "1", "success": false, "operation": "delete", "resource": "ticket",
  "error": { "errorType": "WRITE_OPERATION_BLOCKED", "message": "Write operations are disabled for this tool.", "nextAction": "Enable allowWriteOperations on the AutotaskAiTools node to use mutating operations." } }
```

**`helper-tools.ts` envelope:** Helper tools (`describeFields`, `listPicklistValues`) are separate named tools — their naming convention is `servicename_resource_helperOp` (e.g. `autotask_ticket_describeFields`). These names pass the MCP regex (`^[a-zA-Z0-9_-]{1,128}$`). Helper tool error responses also use `wrapError()` for consistency. Their success responses return plain JSON (not enveloped) since they return metadata, not entity data — this exception is explicitly documented in the template. Helper tools should either omit `outputSchema` or provide a helper-specific `outputSchema` matching their plain JSON shape (not the standard envelope schema).

#### Envelope TypeScript interfaces

```typescript
/** Base shape shared by all tool responses */
interface ToolEnvelope {
  schemaVersion: string;
  success: boolean;
  operation: string;
  resource: string;
}

/** Success response — `result` varies by operation */
interface SuccessEnvelope extends ToolEnvelope {
  success: true;
  result: unknown;
}

/** Error response — unified error object */
interface ErrorEnvelope extends ToolEnvelope {
  success: false;
  error: {
    errorType: string;
    message: string;
    nextAction: string;
    context?: Record<string, unknown>;
  };
}

/** Factory: build a success envelope */
function wrapSuccess(resource: string, operation: string, result: unknown): SuccessEnvelope {
  return { schemaVersion: '1', success: true, operation, resource, result };
}

/** Factory: build an error envelope */
function wrapError(
  resource: string,
  operation: string,
  errorType: string,
  message: string,
  nextAction: string,
  context?: Record<string, unknown>,
): ErrorEnvelope {
  return {
    schemaVersion: '1', success: false, operation, resource,
    error: { errorType, message, nextAction, ...(context ? { context } : {}) },
  };
}

/** Named errorType constants */
const ERROR_TYPES = {
  API_ERROR: 'API_ERROR',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  NO_RESULTS_FOUND: 'NO_RESULTS_FOUND',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_OPERATION: 'INVALID_OPERATION',
  WRITE_OPERATION_BLOCKED: 'WRITE_OPERATION_BLOCKED',
} as const;
```

Call sites in `tool-executor.ts` do `return JSON.stringify(wrapSuccess(...))` or `return JSON.stringify(wrapError(...))`. The `INVALID_OPERATION` error in `func()` (in the node file, not executor) also uses `wrapError(resource, operation, ERROR_TYPES.INVALID_OPERATION, ...)` for envelope consistency.

---

## Architecture

### File Actions

| File | Action |
|---|---|
| `skill.md` | Full rewrite |
| `references/code-templates.md` | Targeted block rewrites (6 blocks) |
| `references/discoveries.md` | Reset: header + promoted entries (status: promoted) + blank template for new learnings. No active entries. |

### skill.md — New Section Order

```
1. Compatibility Matrix          ← new (req 2)
2. Pre-flight (Optional Accelerators)  ← rewritten (req 1, 9)
3. Step 0: Explore Subagent
4. Step 0.5: Implementation Plan
5. Write Safety Model            ← new section (req 3)
6. Result Envelope Standard      ← new section (req 6)
7. Step 1: File Structure
8. Step 2: runtime.ts            ← hardened anchor (req 7, 8)
9. Step 3: error-formatter.ts    ← updated for new envelope
10. Step 4: schema-generator.ts  ← promoted discovery: search-before-name (req 8)
11. Step 5: description-builders.ts
12. Step 6: helper-tools.ts (optional)
13. Step 7: tool-executor.ts     ← promoted discoveries: root, operation, null, filter-empty (req 8, 11)
14. Step 8: MyServiceAiTools.node.ts  ← three-layer write enforcement (req 3)
15. Step 9: MCP Metadata         ← split current/future-ready (req 5)
16. Step 10: Register package.json
17. Step 11: QA                  ← MCP tool name validation (req 4)
18. Step 12: Systematic Debugging
19. Step 13: Retrofitting
20. Key Facts                    ← updated, promoted discoveries integrated (req 8)
21. Capturing Discoveries        ← safety-critical excluded from notebook scope (req 11)
```

### skill.md — Section Dispositions

Each section is either **rewrite** (new content from this spec), **modify** (keep v1 structure, apply specific deltas), or **verbatim** (copy unchanged from v1):

| Section | Disposition | Notes |
|---|---|---|
| 1. Compatibility Matrix | **rewrite** | New section, content specified in this spec |
| 2. Pre-flight | **rewrite** | Remove mandatory skill deps, add Optional Accelerators callout |
| 3. Step 0: Explore Subagent | **verbatim** | No changes needed |
| 4. Step 0.5: Implementation Plan | **modify** | Remove superpowers:writing-plans reference, keep plan structure. Add: "If `superpowers:dispatching-parallel-agents` is available, use it for wave dispatch. Otherwise, implement files in wave order manually: Wave 1 (runtime.ts, error-formatter.ts), Wave 2 (schema-generator.ts, description-builders.ts), Wave 3 (tool-executor.ts, node file)." |
| 5. Write Safety Model | **rewrite** | New section, content specified in this spec |
| 6. Result Envelope Standard | **rewrite** | New section, interfaces + factories from this spec |
| 7. Step 1: File Structure | **verbatim** | No changes needed |
| 8. Step 2: runtime.ts | **rewrite** | Hardened anchor with ANCHOR_CANDIDATES, promoted instanceof discovery |
| 9. Step 3: error-formatter.ts | **rewrite** | New envelope factories replace StructuredToolError |
| 10. Step 4: schema-generator.ts | **modify** | Add promoted discovery rule: `search` before `name` in schema property order |
| 11. Step 5: description-builders.ts | **verbatim** | No changes needed |
| 12. Step 6: helper-tools.ts | **modify** | Add note: error responses use `wrapError()`, success responses plain JSON |
| 13. Step 7: tool-executor.ts | **rewrite** | Envelope wrapping, promoted discoveries (null guard, filter-empty, root, operation stripping) |
| 14. Step 8: MyServiceAiTools.node.ts | **rewrite** | Three-layer write enforcement, INVALID_OPERATION uses wrapError |
| 15. Step 9: MCP Metadata | **modify** | Split into "Current" and "Future-Ready" subsections |
| 16. Step 10: Register package.json | **verbatim** | No changes needed |
| 17. Step 11: QA | **modify** | Add tool name validation check 11b, add infrastructure routing check |
| 18. Step 12: Systematic Debugging | **verbatim** | No changes needed |
| 19. Step 13: Retrofitting | **modify** | Add envelope migration step: "Replace all `formatXxx()` calls with `wrapSuccess()`/`wrapError()` calls; replace `StructuredToolError` references with new envelope types; rename `results` to `items` in getAll handlers" |
| 20. Key Facts | **modify** | Integrate promoted discoveries as named rules |
| 21. Capturing Discoveries | **modify** | Add header: safety-critical rules belong in templates, not notebook |

### Compatibility Matrix Content (req 2)

```
n8n:        ≥ 2.10.x
AI Agent:   Tools Agent only (not ReAct, not OpenAI Functions legacy)
MCP target: MCP Server Trigger
Transports: SSE + streamable HTTP (stdio not supported)
Queue note: /mcp* webhook traffic must reach a single n8n worker.
            Horizontal scaling requires sticky-session or single-replica routing
            at the reverse proxy. Code cannot substitute for this.
```

### Pre-flight Rewrite (req 1, 9)

Remove `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:dispatching-parallel-agents`, `superpowers:executing-plans`, `feature-dev:code-reviewer` from mandatory steps.

Critical path becomes:
1. Read compatibility matrix
2. Read `references/discoveries.md` (apply all active entries)
3. Step 0: Explore subagent

"Optional Accelerators" callout box lists the superpowers/feature-dev skills for environments where they are available. Explicitly states: the skill is complete without them.

### Three-Layer Write Safety (req 3)

**Layer 1 — UI parameter**
`allowWriteOperations: boolean` on the node. Defaults to `false`.

**Layer 2 — Runtime enforcement (all three paths must enforce independently)**
- `supplyData()`: filter `effectiveOps` to exclude WRITE_OPERATIONS when `allowWriteOperations=false`. Build schema and description from `effectiveOps` only.
- `func()`: re-check `params.operation` against `effectiveOps` before calling executor. If blocked, return `JSON.stringify(wrapError(resource, operation, 'WRITE_OPERATION_BLOCKED', ...))`. **Behavioral note:** v1 fell back silently to `defaultOp`; v2 returns a structured error — this is an intentional breaking change.
- `execute()`: re-check `item.json.operation` against `effectiveOps` before calling executor. If blocked, return `JSON.stringify(wrapError(...))` as the item output. **Behavioral note:** v1 fell back silently to `defaultOp`; v2 returns a structured error — same intentional change as `func()`.

**Layer 3 — Description rules for mutating operations**
- `delete`: "ONLY on explicit user intent. Do not infer from context. Confirm ID is correct before proceeding."
- `create`/`update`: "Confirm field values with user before executing when acting autonomously."
- `archive`/`unarchive`: No additional warning beyond what `buildArchiveDescription` already provides ("prefer archive over delete", "NOT deleted — restorable"). These are non-destructive write ops.
- MCP human-in-the-loop note: "MCP clients that support `confirmation` metadata should gate destructive operations on explicit user acknowledgement. This is infrastructure-level safety — the tool description reinforces but does not replace it."

### MCP Tool Name Validation (req 4)

New mandatory QA check added to Step 11 (before code review, after build):

**Check 11b: Tool name validation**
- Pattern: `^[a-zA-Z0-9_-]{1,128}$`
- No spaces, no unicode, ASCII only
- Unique across all tools returned by this node's `supplyData()`
- Convention: `servicename_resourcename` (no operation suffix — operation is in schema)

### Current vs Future-Ready MCP Metadata (req 5)

**Step 9 splits into two subsections:**

*Current (mandatory in all implementations):*
`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` per operation type. Already in v1.

*Future-ready (optional, template provided, not yet required by n8n/LangChain):*
- `title`: human-readable display name (e.g., "Autotask Ticket")
- `annotations`: object containing the hint flags above
- `outputSchema`: JSON Schema describing the result envelope (`schemaVersion: "1"` shape)
- `structuredContent`: structured result object — always mirror as `text` for LangChain backwards compat

Template shows both together so implementers can add future-ready metadata without rework.

### Hardened Runtime Anchor (req 7)

`runtime.ts` template updated to:

```typescript
const ANCHOR_CANDIDATES = [
  '@langchain/classic/agents',  // primary: stable in n8n ≥ 2.4.x
  'langchain/agents',           // secondary: fallback
];

let runtimeRequire: NodeRequire | null = null;
const errors: string[] = [];

for (const candidate of ANCHOR_CANDIDATES) {
  try {
    const resolved = require.resolve(candidate);
    runtimeRequire = createRequire(resolved);
    break;
  } catch (e) {
    errors.push(`${candidate}: ${(e as Error).message}`);
  }
}

if (!runtimeRequire) {
  throw new Error(
    `[runtime.ts] Could not resolve LangChain anchor. Tried:\n${errors.join('\n')}\n` +
    `Ensure @n8n/nodes-langchain is installed in n8n's node_modules.`
  );
}
```

Diagnostic message identifies exactly which candidates were tried and why each failed.

**Resolution context note:** `require.resolve(candidate)` succeeds here because n8n loads community nodes within its own module resolution context — community node packages share n8n's `node_modules` tree. This is a deployment assumption, not a code guarantee. If a future n8n deployment model isolates community node module resolution, the `paths` option (`require.resolve(candidate, { paths: [n8nPackagePath] })`) would be needed. This assumption is documented as a comment in the template.

### Promoted Discoveries → Core Template Rules (req 8, 11)

All 6 active discoveries become non-optional rules embedded in their respective steps:

| Discovery | Promoted To |
|---|---|
| instanceof dual-fix | Step 2 (runtime.ts) — anchor strategy section |
| `root` field injection | Step 7 (tool-executor.ts) — N8N_METADATA_FIELDS block |
| LLM defaults to `name` over `search` | Step 4 (schema-generator.ts) — schema ordering rules |
| `operation` leaks into API bodies | Step 7 (tool-executor.ts) — metadata stripping block |
| Null get → LLM hallucination | Step 7 (tool-executor.ts) — null guard rule |
| Filtered empty getAll → data fabrication | Step 7 (tool-executor.ts) — filter-empty guard rule |

`discoveries.md` resets to a stub with format template only. Header note added: "Discoveries that affect correctness or data safety belong in the main template, not here. This notebook is for new, unconfirmed learnings only."

The 6 promoted discoveries are **retained in `discoveries.md` with `status: promoted`** (per existing maintenance policy — kept for history). No active entries remain after promotion.

### MCP Queue-Mode Infrastructure Note (req 10)

Added in two places:
1. Compatibility Matrix (top of file) — queue/replica caveat
2. Step 11 QA — "Infrastructure check: if deploying with queue mode or multiple webhook replicas, verify /mcp* traffic is routed to a single worker. This is not testable with npm run build — it requires deployment verification."

---

## Template Blocks Changed in code-templates.md

| Template | Changes |
|---|---|
| `runtime.ts` | Ordered ANCHOR_CANDIDATES array, try/catch loop, fail-fast diagnostic error, resolution context comment |
| `error-formatter.ts` | Retire `StructuredToolError` interface; introduce `wrapSuccess(resource, operation, result)` and `wrapError(resource, operation, errorType, message, nextAction, context?)` factory functions; add `WRITE_OPERATION_BLOCKED` errorType constant |
| `tool-executor.ts` | All return paths use `JSON.stringify(wrapSuccess(...))` or `JSON.stringify(wrapError(...))`; `items` instead of `results` in getAll; three-layer write gate in `func()` and `execute()` with explicit structured error return (not silent fallback); promoted null/filter-empty guards as named rules |
| `MyServiceAiTools.node.ts` | Three-layer write enforcement in supplyData/func/execute; `func()` and `execute()` return `wrapError(WRITE_OPERATION_BLOCKED)` when blocked; MCP tool name validation assertion comment in supplyData |
| `helper-tools.ts` | Error responses use `wrapError()`; success responses remain plain JSON (documented exception); tool names follow `servicename_resource_helperOp` pattern |
| MCP annotations block | Add future-ready metadata section (title, outputSchema, structuredContent with text mirror) |

---

## Sub-Agent Execution Plan

### Wave 1 — Parallel drafting
- **Agent A**: Draft full `skill.md` rewrite with all 11 changes. Inputs: this design doc + current skill.md content.
- **Agent B**: Draft all 5 template block rewrites for `code-templates.md`. Inputs: this design doc + current code-templates.md content.

### Wave 2 — Cross-review (parallel)
- **Agent C**: Review Agent A's draft against all 11 requirements. Produce gap list.
- **Agent D**: Review Agent B's draft for TypeScript validity, envelope consistency, anchor ordering correctness.

### Wave 3 — Final write (sequential)
Apply Wave 2 fixes, write all three files to disk, verify 11-requirement coverage checklist.

---

## Acceptance Criteria

- [ ] skill.md opens with compatibility matrix before any other content
- [ ] No mandatory `Skill()` tool calls in the critical path (all moved to Optional Accelerators)
- [ ] Three-layer write safety documented and enforced in all three templates (supplyData, func, execute)
- [ ] `func()` and `execute()` return structured `WRITE_OPERATION_BLOCKED` error (not silent fallback) when write is blocked
- [ ] runtime.ts template uses ANCHOR_CANDIDATES array with try/catch, fail-fast diagnostic, and resolution context comment
- [ ] Step 11 QA includes tool name regex validation check (`^[a-zA-Z0-9_-]{1,128}$`)
- [ ] Step 9 has clearly labelled "Current" and "Future-Ready" subsections
- [ ] `error-formatter.ts` template exports `wrapSuccess()` and `wrapError()` — `StructuredToolError` interface is retired
- [ ] All tool-executor.ts return paths use `wrapSuccess()` or `wrapError()` — no bare object returns
- [ ] All responses include `resource` in the envelope (success and error)
- [ ] getAll uses `items` not `results`
- [ ] `helper-tools.ts` template: error responses use `wrapError()`, success responses are plain JSON (exception documented)
- [ ] All 6 discoveries are integrated as named rules in their respective steps
- [ ] discoveries.md header explicitly excludes safety-critical content from the notebook
- [ ] discoveries.md retains 6 promoted entries with `status: promoted`
- [ ] MCP queue-mode infrastructure caveat appears in compatibility matrix AND Step 11 QA
- [ ] `npm run build` is still listed as mandatory in Step 11

---

## Files to Create/Modify

| Path | Action |
|---|---|
| `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md` | Full rewrite |
| `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md` | 6 block rewrites |
| `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md` | Reset to stub |
