# n8n-add-ai-tools Skill v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `n8n-add-ai-tools` skill (3 files) to address 11 structural requirements: self-contained pre-flight, compatibility matrix, three-layer write safety, MCP tool name validation, current/future MCP metadata split, stable result envelope, hardened runtime anchor, promoted discoveries, and infrastructure correctness notes.

**Architecture:** Full rewrite of `skill.md` (21 sections, disposition-driven: verbatim/modify/rewrite per spec); 6 targeted block rewrites in `code-templates.md`; reset of `discoveries.md` to promote all 6 active entries. Wave-based parallel sub-agent execution: Wave 1 (parallel draft), Wave 2 (parallel cross-review), Wave 3 (final write + verify).

**Tech Stack:** Markdown (skill files), TypeScript code embedded in templates, Git for commits.

**Spec:** `docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md`

---

## Chunk 1: Wave 1 — Parallel Drafting

### Task 1: Draft new skill.md (Wave 1a — sub-agent)

**Files:**
- Modify: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md` (full rewrite)

**Context for sub-agent:**
- Spec: `docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md`
- Current file: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md`

- [ ] **Step 1: Dispatch sub-agent to draft skill.md**

Provide the sub-agent with this prompt:

```
You are rewriting C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md from scratch.

INPUTS:
1. Read the design spec: C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md
2. Read the current skill: C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md

INSTRUCTIONS:
Follow the "Section Dispositions" table in the spec exactly:
- verbatim → copy from current skill unchanged
- modify → apply the exact delta described in the spec, keep rest of section intact
- rewrite → write new content from scratch using spec guidance

The YAML frontmatter (lines 1-5 of current file) must be preserved verbatim.

Critical new content to include:
1. Compatibility Matrix (new section 1, before Pre-flight):
   n8n ≥ 2.10.x, Tools Agent only, MCP Server Trigger, SSE + streamable HTTP, stdio not supported,
   queue/replica caveat: /mcp* traffic must reach a single n8n worker.

2. Pre-flight rewrite: Remove all mandatory Skill() invocations. Add "Optional Accelerators" callout box
   listing superpowers:brainstorming, superpowers:writing-plans, superpowers:dispatching-parallel-agents,
   superpowers:executing-plans, feature-dev:code-reviewer. State: "The skill is complete without them."
   New critical path: (1) Read compatibility matrix, (2) Read references/discoveries.md (apply all
   active entries to your plan), (3) Step 0 Explore subagent.

3. New section "Write Safety Model" (after Step 0.5, before Step 1):
   Layer 1: allowWriteOperations boolean, default false.
   Layer 2: supplyData() filters effectiveOps; func() re-checks + returns WRITE_OPERATION_BLOCKED error
   (not silent fallback — intentional v2 breaking change); execute() same.
   Layer 3 — description rules for mutating operations:
   - delete: "ONLY on explicit user intent. Do not infer from context. Confirm ID is correct before
     proceeding."
   - create/update: "Confirm field values with user before executing when acting autonomously."
   - archive/unarchive: No additional warning — buildArchiveDescription already frames it as
     non-destructive ("prefer over delete", "NOT deleted — restorable").
   - MCP human-in-the-loop note: "MCP clients that support `confirmation` metadata should gate
     destructive operations on explicit user acknowledgement. This is infrastructure-level safety —
     the tool description reinforces but does not replace it."

4. New section "Result Envelope Standard" (after Write Safety Model, before Step 1):
   wrapSuccess(resource, operation, result) and wrapError(resource, operation, errorType, message,
   nextAction, context?) factories. TypeScript interfaces: ToolEnvelope, SuccessEnvelope, ErrorEnvelope.
   ERROR_TYPES constants. JSON examples for get/getAll/create/error. getAll uses "items" not "results".
   WRITE_OPERATION_BLOCKED example. Call sites do JSON.stringify(wrapSuccess/wrapError).

5. Step 2 runtime.ts — rewrite anchor section:
   ANCHOR_CANDIDATES = ['@langchain/classic/agents', 'langchain/agents'].
   try/catch loop per candidate, fail-fast diagnostic error listing all tried candidates + their errors.
   Comment: "require.resolve() works because n8n loads community nodes within its own module resolution
   context. If future n8n isolates community node resolution, use require.resolve(candidate, {paths: [...]})."

6. Step 3 error-formatter.ts — rewrite:
   StructuredToolError interface is retired. wrapSuccess/wrapError factories are the new pattern.
   formatXxx() helpers are rewritten to call wrapError() internally and become thin wrappers
   (not deleted). Call sites in tool-executor.ts are unchanged. This satisfies the spec's intent
   (retire StructuredToolError, use envelope) while minimising churn at call sites.

7. Step 4 schema-generator.ts — modify:
   Add promoted discovery as named rule: "search MUST precede name in every getAll schema property order.
   LLMs read JSON schema properties top-to-bottom and pick the first matching field."

8. Step 6 helper-tools.ts — modify:
   Add: "Error responses use wrapError() from error-formatter.ts. Success responses return plain JSON
   (not enveloped) since they return metadata — this exception is documented."
   Helper tool naming: servicename_resource_helperOp (e.g. autotask_ticket_describeFields).
   Helper tools should omit outputSchema or provide a helper-specific outputSchema matching plain JSON.

9. Step 7 tool-executor.ts — rewrite:
   All return paths use wrapSuccess() or wrapError(). getAll uses "items" not "results".
   Promoted discoveries as named rules:
   - "root field injection" rule: include root in N8N_METADATA_FIELDS
   - "operation leaks" rule: include operation in N8N_METADATA_FIELDS
   - "null get guard" rule: return wrapError(ENTITY_NOT_FOUND) for null/empty get responses
   - "filtered empty getAll guard" rule: check hasFilters && records.length === 0 →
     return wrapError(NO_RESULTS_FOUND)
   INVALID_OPERATION (default case) also uses wrapError with ERROR_TYPES.INVALID_OPERATION.

10. Step 8 MyServiceAiTools.node.ts — rewrite:
    Three-layer write enforcement: supplyData() filters effectiveOps; func() re-checks + returns
    wrapError(WRITE_OPERATION_BLOCKED) if blocked (not silent fallback); execute() same.
    INVALID_OPERATION in func() uses wrapError(ERROR_TYPES.INVALID_OPERATION).
    MCP tool name validation comment in supplyData.

11. Step 9 MCP Metadata — modify to split into two subsections:
    "Current (mandatory)": readOnlyHint, destructiveHint, idempotentHint, openWorldHint.
    "Future-Ready (optional)": title, annotations, outputSchema (references result envelope schema),
    structuredContent (mirror as text for LangChain backwards compat).

12. Step 11 QA — modify:
    Add Check 11b (before code review, after build): Tool name validation.
    Pattern: ^[a-zA-Z0-9_-]{1,128}$. No spaces. ASCII only. Unique across all tools from supplyData().
    Convention: servicename_resourcename (no operation suffix).
    Add Infrastructure check: if deploying with queue mode, verify /mcp* traffic is routed to a single
    worker. Not testable with npm run build — requires deployment verification.

13. Step 13 Retrofitting — modify:
    Add as migration step 7: "Replace all formatXxx() calls with wrapSuccess()/wrapError() calls.
    Replace StructuredToolError references with new envelope types. Rename 'results' to 'items' in
    getAll handlers."

14. Step 0.5 Implementation Plan — modify:
    Replace superpowers:writing-plans mandatory reference with optional reference.
    Add: "If superpowers:dispatching-parallel-agents is available, use it for wave dispatch.
    Otherwise, implement files in wave order: Wave 1 (runtime.ts, error-formatter.ts),
    Wave 2 (schema-generator.ts, description-builders.ts),
    Wave 3 (tool-executor.ts, node file)."

15. Capturing Discoveries — modify:
    Add header: "Discoveries that affect correctness or data safety belong in the main skill template,
    not here. This notebook is for new, unconfirmed learnings only."

16. Key Facts section — modify (disposition: modify):
    Integrate the 6 promoted discoveries as named rules. After the existing 6 key facts, add 4 more
    (or integrate into existing entries):
    - "root field injection" — n8n injects `root` (canvas UUID) into every tool call; always include
      in N8N_METADATA_FIELDS.
    - "operation leaks via execute() path" — include `operation` in N8N_METADATA_FIELDS as
      defense-in-depth; func() strips it but execute() path passes raw item.json.
    - "null get → hallucination" — always null-check get responses; return wrapError(ENTITY_NOT_FOUND)
      for null/empty/empty-array/empty-object; never wrap null in success envelope.
    - "filtered empty getAll → fabrication" — check hasFilters && records.length === 0 and return
      wrapError(NO_RESULTS_FOUND); unfiltered empty is valid.
    - "search before name" — already in current Key Fact #4; update wording to say "named rule" and
      note it applies to every getAll schema without exception.
    Keep all existing 6 key facts; add the new ones or merge where they overlap.

DO NOT write the file — output the full content as your response.
The content will be reviewed and then written to disk in Wave 3.
```

- [ ] **Step 2: Capture sub-agent skill.md draft output**

Store the draft for use in Task 3 (Wave 2 review).

---

### Task 2: Draft code-templates.md blocks (Wave 1b — sub-agent, parallel with Task 1)

**Files:**
- Modify: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md` (6 block rewrites)

- [ ] **Step 1: Dispatch sub-agent to draft 6 template blocks**

Provide the sub-agent with this prompt:

```
You are rewriting 6 specific blocks in the code templates file for the n8n-add-ai-tools skill.

INPUTS:
1. Read the design spec: C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md
2. Read the current templates: C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md

You must rewrite exactly these 6 blocks. All other content (table of contents, section headers,
surrounding prose) is preserved verbatim.

BLOCK 1: runtime.ts
Replace the getRuntimeRequire() function (lines 34-47) with:
- const ANCHOR_CANDIDATES = ['@langchain/classic/agents', 'langchain/agents'] with comments
- try/catch loop: for each candidate, try require.resolve(candidate), createRequire(resolved), break on success
- push error message to errors array on catch
- after loop: if runtimeRequire is null, throw new Error with diagnostic listing all tried candidates
- comment: "require.resolve() works because n8n loads community nodes within its own module resolution
  context. If future n8n isolates community node resolution, use {paths:[n8nPackagePath]} option."

BLOCK 2: error-formatter.ts
Replace the entire block with new envelope-based implementation:
- Remove StructuredToolError interface
- Add these TypeScript interfaces:
  interface ToolEnvelope { schemaVersion: string; success: boolean; operation: string; resource: string; }
  interface SuccessEnvelope extends ToolEnvelope { success: true; result: unknown; }
  interface ErrorEnvelope extends ToolEnvelope { success: false; error: { errorType: string; message: string; nextAction: string; context?: Record<string, unknown>; }; }
- Add ERROR_TYPES const with AT MINIMUM: API_ERROR, ENTITY_NOT_FOUND, NO_RESULTS_FOUND,
  MISSING_REQUIRED_FIELD, MISSING_ENTITY_ID, INVALID_OPERATION, WRITE_OPERATION_BLOCKED,
  PERMISSION_DENIED, VALIDATION_ERROR
  (The last three are extensions beyond the spec minimum — include them since they map to the
  existing formatApiError classification logic and preserve backwards compatibility.)
- Add wrapSuccess(resource, operation, result): SuccessEnvelope function
- Add wrapError(resource, operation, errorType, message, nextAction, context?): ErrorEnvelope function
- The spec says formatXxx() helpers are "replaced" by direct wrapError() calls. Implement this by
  REWRITING the formatXxx() functions to call wrapError() internally and return ErrorEnvelope.
  They are NOT deleted — they become thin convenience wrappers so existing call sites in
  tool-executor.ts work without change. This satisfies the spec's intent (retire StructuredToolError,
  use envelope) while minimising churn at call sites.

BLOCK 3: tool-executor.ts
Rewrite the entire executeAiTool function:
- Keep N8N_METADATA_FIELDS set (with root and operation in it — add comments explaining each)
- All return paths use JSON.stringify(wrapSuccess(...)) or JSON.stringify(wrapError(...))
- get case: return JSON.stringify(wrapSuccess(resource, operation, result)) on success
  null guard: return JSON.stringify(wrapError(resource, operation, ERROR_TYPES.ENTITY_NOT_FOUND, ...))
- getAll case: return JSON.stringify(wrapSuccess(resource, operation, { items: records, count: N }))
  (NOTE: "items" not "results")
  truncated note goes inside result: { items, count, truncated: true, note }
  filter-empty guard: return JSON.stringify(wrapError(resource, operation, ERROR_TYPES.NO_RESULTS_FOUND, ...))
- create/update: return JSON.stringify(wrapSuccess(resource, operation, { id: result.id, ...result }))
- delete: return JSON.stringify(wrapSuccess(resource, operation, { id: params.id, deleted: true }))
- archive/unarchive: return JSON.stringify(wrapSuccess(resource, operation, { id: params.id }))
- default (INVALID_OPERATION): return JSON.stringify(wrapError(resource, operation, ERROR_TYPES.INVALID_OPERATION, ...))
- catch: return JSON.stringify(wrapError(resource, operation, ERROR_TYPES.API_ERROR, ...))
Update imports: remove formatApiError etc from import, add wrapSuccess, wrapError, ERROR_TYPES

BLOCK 4: MyServiceAiTools.node.ts
Three changes:
A. In supplyData(): after enabledOperations filter, add MCP tool name validation comment:
   // Tool name must match ^[a-zA-Z0-9_-]{1,128}$ — no spaces, ASCII only, unique per node
   // Convention: servicename_resourcename (no operation suffix; operation is in schema)
B. In func(): replace INVALID_OPERATION return with wrapError call:
   return JSON.stringify(wrapError(resource, operationFromArgs as string ?? 'unknown',
     ERROR_TYPES.INVALID_OPERATION,
     'Missing or unsupported operation for this tool call.',
     `Allowed operations: ${enabledOperations.join(', ')}.`));
   Also add write-blocked check BEFORE the invalid operation check:
   if (operation && WRITE_OPERATIONS.includes(operation) && !allowWriteOperations) {
     return JSON.stringify(wrapError(resource, operation, ERROR_TYPES.WRITE_OPERATION_BLOCKED,
       'Write operations are disabled for this tool.',
       'Enable allowWriteOperations on this node to use mutating operations.'));
   }
C. In execute(): replace silent fallback with structured error.
   NOTE: getDefaultOperation() IS defined in the current template (line 751 of current code-templates.md)
   and must be retained verbatim.
   Replace the single-line effectiveOp assignment:
     const effectiveOp = (requestedOp && effectiveOps.includes(requestedOp)) ? requestedOp : defaultOp;
   With this block (note: `defaultOp` was declared earlier in the current template — keep it):
     if (requestedOp && WRITE_OPERATIONS.includes(requestedOp) && !allowWriteOperations) {
       response.push({
         json: parseToolResult(JSON.stringify(wrapError(
           resource, requestedOp, ERROR_TYPES.WRITE_OPERATION_BLOCKED,
           'Write operations are disabled.',
           'Enable allowWriteOperations on this node to use mutating operations.',
         ))),
         pairedItem: { item: itemIndex },
       });
       continue;
     }
     const effectiveOp = (requestedOp && effectiveOps.includes(requestedOp))
       ? requestedOp
       : getDefaultOperation(effectiveOps);
Add import: import { wrapSuccess, wrapError, ERROR_TYPES } from './ai-tools/error-formatter';

BLOCK 5: helper-tools.ts
Two changes:
A. Update error return in func() of each helper tool from:
   return JSON.stringify(formatApiError(...))
   to:
   return JSON.stringify(wrapError(resource, 'describeFields', ERROR_TYPES.API_ERROR, message, 'Retry with valid parameters.'))
B. Add comment above the file:
   // Helper tool names follow: servicename_resource_helperOp (e.g. autotask_ticket_describeFields)
   // Success responses return plain JSON (not enveloped) — metadata, not entity data.
   // outputSchema should be omitted or customized to match this plain JSON shape.
   // Error responses use wrapError() for envelope consistency.
Update imports: add wrapError, ERROR_TYPES; keep or remove formatApiError as needed.

BLOCK 6: MCP annotations block
After the existing MCP_ANNOTATIONS_BY_OPERATION table, add a new subsection:

## Future-Ready MCP Metadata (optional)

These fields are part of the MCP specification but not yet required by n8n or LangChain.
Include them when building custom MCP servers or to future-proof for n8n support.

```typescript
// Future-ready metadata — not currently consumed by n8n DynamicStructuredTool
const FUTURE_MCP_METADATA = {
  // title: Human-readable display name shown in MCP clients
  title: 'My Service Ticket',

  // annotations: MCP hint flags (same as MCP_ANNOTATIONS_BY_OPERATION above)
  annotations: {
    readOnlyHint: false,   // false if ANY write op is enabled on this tool
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  // outputSchema: JSON Schema describing the result envelope shape (schemaVersion: "1")
  // Allows MCP clients to validate and process structured responses.
  outputSchema: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'string', const: '1' },
      success: { type: 'boolean' },
      operation: { type: 'string' },
      resource: { type: 'string' },
      result: { type: 'object' },   // present when success: true
      error: {                      // present when success: false
        type: 'object',
        properties: {
          errorType: { type: 'string' },
          message: { type: 'string' },
          nextAction: { type: 'string' },
          context: { type: 'object' },
        },
        required: ['errorType', 'message', 'nextAction'],
      },
    },
    required: ['schemaVersion', 'success', 'operation', 'resource'],
  },

  // structuredContent: Return both structured object AND text string.
  // IMPORTANT: always mirror as text for LangChain backwards compatibility.
  // Example func() return pattern:
  //   const envelope = wrapSuccess(resource, operation, result);
  //   return JSON.stringify(envelope);  // text (required for LangChain)
  //   // structuredContent would be: { type: 'json', value: envelope }
  //   // Not yet supported by n8n DynamicStructuredTool — add when n8n supports it.
};
```

DO NOT write the files — output all 6 block rewrites as your response.
The content will be reviewed and then written to disk in Wave 3.
```

- [ ] **Step 2: Capture sub-agent code-templates.md draft output**

Store the draft for use in Task 4 (Wave 2 review).

---

## Chunk 2: Wave 2 — Cross-Review

### Task 3: Review skill.md draft (Wave 2a — sub-agent)

**Files:** (read-only review)
- Input: Draft output from Task 1
- Reference: `docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md`

- [ ] **Step 1: Dispatch sub-agent to review skill.md draft**

Provide the sub-agent with this prompt:

```
You are reviewing a drafted rewrite of the n8n-add-ai-tools skill.md file.

INPUTS:
1. Read the design spec: C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md
2. The skill.md draft is provided directly in this prompt (paste draft here).

REVIEW CHECKLIST — verify each item:
[ ] File opens with Compatibility Matrix (n8n ≥ 2.10.x, Tools Agent, SSE+HTTP, queue caveat)
[ ] Pre-flight has "Optional Accelerators" callout — no mandatory Skill() tool calls
[ ] New "Write Safety Model" section present with 3 layers
[ ] Layer 2 explicitly states func() and execute() return WRITE_OPERATION_BLOCKED (not silent fallback)
[ ] New "Result Envelope Standard" section present with wrapSuccess/wrapError TypeScript code
[ ] ERROR_TYPES constants defined in the envelope section
[ ] Step 2 runtime.ts uses ANCHOR_CANDIDATES array with try/catch loop + fail-fast error
[ ] runtime.ts resolution context comment present
[ ] Step 3 error-formatter.ts says StructuredToolError is retired, wrapSuccess/wrapError used
[ ] Step 4 schema-generator.ts has "search MUST precede name" as a named rule
[ ] Step 6 helper-tools.ts mentions wrapError() for errors, plain JSON for success, naming convention
[ ] Step 7 tool-executor.ts shows promoted discoveries as named rules (root injection, operation leak, null guard, filter-empty guard)
[ ] Step 7 references "items" not "results" for getAll
[ ] Step 8 node file has three-layer write enforcement (supplyData + func + execute)
[ ] Step 8 func() INVALID_OPERATION uses wrapError (not bare object)
[ ] Step 9 MCP Metadata has "Current" and "Future-Ready" subsections
[ ] Step 11 QA has Check 11b: tool name regex ^[a-zA-Z0-9_-]{1,128}$
[ ] Step 11 QA has infrastructure routing check
[ ] Step 13 Retrofitting includes envelope migration step
[ ] Step 0.5 has manual wave fallback instructions
[ ] Capturing Discoveries has header excluding safety-critical content
[ ] Key Facts section updated with promoted discoveries — verify at least 4 of these 6 named rules appear: "root field injection", "operation leaks via execute() path", "null get → hallucination", "filtered empty getAll → fabrication", "search before name", "instanceof anchor"
[ ] YAML frontmatter preserved (name, description, argument-hint)

For each failed check: report [FAIL: <item>] with specific fix required.
For each passed check: report [PASS: <item>].
End with: APPROVED or NEEDS FIXES.
```

- [ ] **Step 2: Record review result**

If NEEDS FIXES: note each failing item. These will be applied in Task 5 (Wave 3).
If APPROVED: proceed to Task 4.

---

### Task 4: Review code-templates.md blocks (Wave 2b — sub-agent, parallel with Task 3)

**Files:** (read-only review)
- Input: Draft output from Task 2
- Reference: `docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md`

- [ ] **Step 1: Dispatch sub-agent to review code-templates.md blocks**

Provide the sub-agent with this prompt:

```
You are reviewing 6 rewritten TypeScript template blocks for the n8n-add-ai-tools skill.

INPUTS:
1. Read the design spec: C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md
2. The 6 template blocks are provided directly in this prompt (paste blocks here).

REVIEW CHECKLIST:

runtime.ts block:
[ ] ANCHOR_CANDIDATES array with @langchain/classic/agents first, langchain/agents second
[ ] try/catch loop iterates candidates
[ ] errors array collects failure messages
[ ] fail-fast throw after loop if runtimeRequire still null
[ ] diagnostic error message lists tried candidates and their errors
[ ] resolution context comment present
[ ] TypeScript is syntactically valid

error-formatter.ts block:
[ ] ToolEnvelope, SuccessEnvelope, ErrorEnvelope interfaces present
[ ] wrapSuccess(resource, operation, result) function present
[ ] wrapError(resource, operation, errorType, message, nextAction, context?) function present
[ ] ERROR_TYPES const with at least: ENTITY_NOT_FOUND, NO_RESULTS_FOUND, WRITE_OPERATION_BLOCKED, INVALID_OPERATION, API_ERROR
[ ] Old formatXxx() helpers either removed or updated to call wrapError() internally
[ ] TypeScript is syntactically valid

tool-executor.ts block:
[ ] func() has write-blocked check returning wrapError(WRITE_OPERATION_BLOCKED) before calling executor (three-layer gate: supplyData + func + execute)
[ ] N8N_METADATA_FIELDS includes 'root' and 'operation' with comments
[ ] get case: success uses wrapSuccess(resource, operation, result)
[ ] get case: null guard uses wrapError(... ENTITY_NOT_FOUND ...)
[ ] getAll case: success uses items not results (result: { items, count })
[ ] getAll case: filter-empty guard uses wrapError(... NO_RESULTS_FOUND ...)
[ ] create/update/delete/archive: success uses wrapSuccess
[ ] default case: uses wrapError(... INVALID_OPERATION ...)
[ ] catch: uses wrapError(... API_ERROR ...)
[ ] All returns are JSON.stringify(wrapSuccess/wrapError) — no bare object returns
[ ] TypeScript is syntactically valid

MyServiceAiTools.node.ts block:
[ ] supplyData() has MCP tool name validation comment
[ ] func() has write-blocked check returning wrapError(WRITE_OPERATION_BLOCKED)
[ ] func() write-blocked check comes BEFORE invalid operation check
[ ] func() INVALID_OPERATION returns wrapError (not bare { error: true } object)
[ ] execute() has write-blocked check returning wrapError(WRITE_OPERATION_BLOCKED) instead of silent fallback
[ ] Imports include wrapSuccess, wrapError, ERROR_TYPES from error-formatter
[ ] TypeScript is syntactically valid

helper-tools.ts block:
[ ] Comment at top about naming convention (servicename_resource_helperOp)
[ ] Comment about plain JSON success / outputSchema exception
[ ] func() error returns use wrapError() not formatApiError()
[ ] TypeScript is syntactically valid

MCP annotations block:
[ ] Current annotations table preserved
[ ] New "Future-Ready MCP Metadata" subsection added
[ ] title, annotations, outputSchema, structuredContent all present
[ ] outputSchema matches result envelope shape (schemaVersion, success, operation, resource, result/error)
[ ] structuredContent comment mentions text mirror for LangChain backwards compat

For each failed check: report [FAIL: <item>] with specific fix required.
End with: APPROVED or NEEDS FIXES.
```

- [ ] **Step 2: Record review result**

If NEEDS FIXES: note each failing item. These will be applied in Task 6 (Wave 3).
If APPROVED: proceed to Task 5.

---

## Chunk 3: Wave 3 — Final Write, Verify, Commit

### Task 5: Write final skill.md

**Files:**
- Modify: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md`

- [ ] **Step 1: Apply Task 3 review fixes to skill.md draft**

Take the draft from Task 1 and apply all FAIL items from Task 3.

- [ ] **Step 2: Write skill.md to disk**

Write the corrected draft to `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md`.

- [ ] **Step 3: Verify acceptance criteria — skill.md**

Run these checks (grep/read the file):

```bash
# Check 1: Compatibility matrix is first content section
grep -n "2\.10\.x" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md" | head -3
# Expected: appears in first ~30 lines

# Check 2: No mandatory Skill() calls in pre-flight
grep -n "Invoke.*upfront" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: 0 results (or results only in Optional Accelerators section)

# Check 3: Write safety model present
grep -n "WRITE_OPERATION_BLOCKED\|three-layer\|Write Safety" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: multiple matches

# Check 4: Envelope section present
grep -n "wrapSuccess\|wrapError\|schemaVersion" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: multiple matches

# Check 5: ANCHOR_CANDIDATES in runtime section
grep -n "ANCHOR_CANDIDATES\|langchain/classic" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 2 matches

# Check 6: Tool name regex in QA section
grep -n "a-zA-Z0-9_-\|1,128\|11b" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 1 match

# Check 7: Items not results in getAll guidance
grep -n '"items"' "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 1 match in tool-executor section

# Check 8: Current/Future-Ready in Step 9
grep -n "Future-Ready\|Current.*mandatory" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 2 matches

# Check 9: Infrastructure routing note
grep -n "infrastructure\|single worker\|sticky" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 2 matches (matrix + QA)

# Check 10: Discoveries header
grep -n "safety-critical\|notebook is for new" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
# Expected: at least 1 match
```

If any check produces unexpected output, fix the file and re-run.

---

### Task 6: Write final code-templates.md

**Files:**
- Modify: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md`

- [ ] **Step 1: Apply Task 4 review fixes to code-templates.md blocks**

Take the 6 block drafts from Task 2 and apply all FAIL items from Task 4.

- [ ] **Step 2: Splice blocks into code-templates.md**

The file structure is preserved — only the 6 named blocks are replaced. Keep all table of contents entries, section headers, and surrounding prose verbatim. Replace the TypeScript code fenced blocks for each of the 6 sections.

Write the updated file to `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md`.

- [ ] **Step 3: Verify acceptance criteria — code-templates.md**

```bash
# Check 1: ANCHOR_CANDIDATES present
grep -n "ANCHOR_CANDIDATES" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: at least 1 match

# Check 2: wrapSuccess and wrapError exported
grep -n "export function wrapSuccess\|export function wrapError" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: exactly 2 matches

# Check 3: StructuredToolError retired (should not appear as an interface)
grep -n "interface StructuredToolError" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: 0 results

# Check 4: items not results in getAll
grep -n '"items"' "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: at least 1 match in tool-executor block

# Check 5: WRITE_OPERATION_BLOCKED in node file
grep -n "WRITE_OPERATION_BLOCKED" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: at least 2 matches (func + execute)

# Check 6: No bare { error: true } returns in updated blocks
grep -n "{ error: true" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: 0 results (all replaced with wrapError calls)

# Check 7: Future-Ready MCP section present
grep -n "Future-Ready\|outputSchema\|structuredContent" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: multiple matches

# Check 8: ERROR_TYPES constants
grep -n "ERROR_TYPES\|ENTITY_NOT_FOUND\|NO_RESULTS_FOUND" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: multiple matches

# Check 9: helper-tools naming convention comment
grep -n "servicename_resource_helperOp\|plain JSON" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
# Expected: at least 1 match
```

If any check fails, fix the relevant block and re-run.

---

### Task 7: Write discoveries.md reset

**Files:**
- Modify: `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md`

- [ ] **Step 1: Write discoveries.md**

Write the following content to `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md`:

```markdown
# Discoveries

Learnings captured during real implementations of the n8n AI Tools skill.

> **Scope:** This notebook is for new, unconfirmed learnings only. Discoveries that affect
> correctness or data safety belong in the main skill template (`skill.md`) and code templates,
> not here. When a discovery matures, it should be promoted to the template and marked `promoted`.

Read all `active` entries before starting implementation — they override templates where they conflict.

---

### instanceof fails silently across bundled module copies
- **Date**: 2025-02-15
- **Context**: runtime.ts — `DynamicStructuredTool` and `ZodType` resolution
- **Discovery**: Community nodes bundle their own `zod` and `@langchain/core`. n8n loads its own copies at runtime. Two `instanceof` checks fail silently: `tool.schema instanceof ZodType` and `tool instanceof DynamicStructuredTool`. The tool appears to work in the AI Agent but MCP Trigger silently drops it.
- **Impact**: All runtime classes must come from `runtime.ts` via `createRequire()`. Never import `DynamicStructuredTool` or `ZodType` as value imports from bundled packages.
- **Status**: promoted (incorporated into runtime.ts template anchor strategy)

### `root` field injected by n8n canvas collides with API params
- **Date**: 2025-02-20
- **Context**: tool-executor.ts — N8N_METADATA_FIELDS
- **Discovery**: n8n injects a `root` field (canvas root node UUID) into every DynamicStructuredTool call. If not stripped, it gets sent in API request bodies. Some APIs have their own `root` parameter, causing silent conflicts or 400 errors with unhelpful messages.
- **Impact**: Always include `root` in N8N_METADATA_FIELDS. Error message from API won't point to `root` as the culprit — you have to know to look for it.
- **Status**: promoted (incorporated into tool-executor.ts N8N_METADATA_FIELDS as named rule)

### LLMs default to `name` over `search` for text lookups
- **Date**: 2025-02-22
- **Context**: schema-generator.ts — getAll schema property order
- **Discovery**: When both `search` (partial match) and `name` (exact match) are in a getAll schema, LLMs consistently pick `name` for text-based lookups, which returns empty results because it's exact-match. Moving `search` before `name` in property order and adding "ALWAYS use this first" to the description fixed the problem across multiple LLM models (GPT-4, Claude, Gemini).
- **Impact**: `search` must precede `name` in every getAll schema. `name` must warn "EXACT match". Error `nextAction` strings must explicitly name the `'search'` parameter.
- **Status**: promoted (incorporated into schema-generator.ts rules in skill.md)

### `operation` leaks into API request bodies via execute() path
- **Date**: 2025-03-01
- **Context**: tool-executor.ts — N8N_METADATA_FIELDS
- **Discovery**: The unified tool's `func()` strips `operation` before calling `executeAiTool`, but the `execute()` path (AI Agent) passes raw item JSON that still contains `operation`. For create/update operations, this means `operation: "create"` gets spread into the API request body as an invalid field. Some APIs ignore unknown fields; others return validation errors.
- **Impact**: Include `operation` in N8N_METADATA_FIELDS as defense-in-depth. Don't rely solely on `func()` stripping it.
- **Status**: promoted (incorporated into tool-executor.ts N8N_METADATA_FIELDS as named rule)

### Null get responses cause LLM hallucination
- **Date**: 2025-03-05
- **Context**: tool-executor.ts — get operation handler
- **Discovery**: Some APIs return HTTP 200 with null/empty body instead of 404 when a record doesn't exist. Without a null guard, the tool returns `{ result: null }` which the LLM interprets as success and fabricates record content based on the ID. Adding an explicit `formatNotFoundError` for null/empty responses eliminated this hallucination pattern.
- **Impact**: Always null-check get responses. Check for: `null`, `undefined`, empty array, empty object. Return `wrapError(ENTITY_NOT_FOUND)` instead of wrapping null in success envelope.
- **Status**: promoted (incorporated into tool-executor.ts null guard rule)

### Filtered empty getAll triggers data fabrication
- **Date**: 2025-03-05
- **Context**: tool-executor.ts — getAll operation handler
- **Discovery**: When a getAll with filters returns zero results, the success envelope looks like valid success to the LLM. It then fabricates records matching the filter criteria. Returning `wrapError(NO_RESULTS_FOUND)` with `filtersUsed` context instead gives the LLM an explicit error to work with. Unfiltered empty results are genuinely valid — only filtered empty results need the error.
- **Impact**: Check `hasFilters && records.length === 0` and return `wrapError(NO_RESULTS_FOUND)`. Don't apply this check when no filters were provided.
- **Status**: promoted (incorporated into tool-executor.ts filter-empty guard rule)

---

## Add new discoveries below

Use this format for new entries:

### [Short title]
- **Date**: YYYY-MM-DD
- **Context**: [Which step/file/API this relates to]
- **Discovery**: [What was learned]
- **Impact**: [What to do differently]
- **Status**: new  ← change to `confirmed` when verified, `promoted` once in templates, `retired` if obsolete
```

- [ ] **Step 2: Verify discoveries.md**

```bash
grep -n "status.*promoted" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md" | wc -l
# Expected: 6 lines (all 6 original discoveries marked promoted)

grep -n "status.*active" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md"
# Expected: 0 results (no active entries remain)

grep -n "safety-critical\|notebook is for new" "C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md"
# Expected: at least 1 match (the header note)
```

---

### Task 8: Final acceptance criteria verification

- [ ] **Step 1: Run full acceptance criteria checklist**

Verify all 17 items from the spec:

```bash
SKILL="C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md"
TEMPLATES="C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md"
DISC="C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md"

echo "=== Acceptance Criteria Verification ==="

echo "[1] Compatibility matrix first"
grep -c "2\.10\.x" "$SKILL"

echo "[2] No mandatory Skill() calls"
grep -c "Invoke.*upfront\|mandatory.*skill" "$SKILL"

echo "[3] Write safety model - three layers"
grep -c "Layer 1\|Layer 2\|Layer 3" "$SKILL"

echo "[4] WRITE_OPERATION_BLOCKED error (not silent fallback)"
grep -c "WRITE_OPERATION_BLOCKED" "$SKILL"

echo "[5] ANCHOR_CANDIDATES in skill.md"
grep -c "ANCHOR_CANDIDATES" "$SKILL"

echo "[6] Tool name regex in QA"
grep -c "a-zA-Z0-9_-" "$SKILL"

echo "[7] Current/Future-Ready in Step 9"
grep -c "Future-Ready\|Current.*mandatory" "$SKILL"

echo "[8] wrapSuccess/wrapError in templates"
grep -c "export function wrapSuccess\|export function wrapError" "$TEMPLATES"

echo "[9] No bare StructuredToolError interface"
grep -c "interface StructuredToolError" "$TEMPLATES"

echo "[10] Resource in all template responses"
grep -c "resource.*operation\|wrapSuccess.*resource\|wrapError.*resource" "$TEMPLATES"

echo "[11] items not results in getAll"
grep -c '"items"' "$TEMPLATES"

echo "[12] helper-tools plain JSON exception documented"
grep -c "plain JSON\|servicename_resource_helperOp" "$TEMPLATES"

echo "[13] All 6 discoveries marked promoted"
grep -c "Status.*promoted" "$DISC"

echo "[14] Discoveries header excludes safety-critical"
grep -c "safety-critical\|notebook is for new" "$DISC"

echo "[15] No active discoveries remain"
grep -c "Status.*active" "$DISC"

echo "[16] Queue-mode caveat in 2 places"
grep -c "single worker\|sticky-session\|single.*replica" "$SKILL"

echo "[17] npm run build in Step 11"
grep -c "npm run build" "$SKILL"
```

Expected values for each check:
1. ≥1 | 2. 0 | 3. ≥3 | 4. ≥2 | 5. ≥1 | 6. ≥1 | 7. ≥2 | 8. 2 | 9. 0 | 10. ≥3 | 11. ≥1 | 12. ≥1 | 13. 6 | 14. ≥1 | 15. 0 | 16. ≥2 | 17. ≥1

If any item fails, fix the relevant file and re-run the single failing check before proceeding.

---

### Task 9: Commit

**Files:** (read-only verification before commit)
- `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/skill.md`
- `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/code-templates.md`
- `C:/Users/maxs/.claude/skills/n8n-add-ai-tools/references/discoveries.md`
- `C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md`
- `C:/temp/n8n/n8n-nodes-autotask/docs/superpowers/plans/2026-03-13-n8n-add-ai-tools-v2.md`

- [ ] **Step 1: Verify all three skill files are modified**

```bash
git -C "C:/temp/n8n/n8n-nodes-autotask" status
# Expected: docs/superpowers/ files shown as modified/new

# Note: skill files are outside the project repo — they are in ~/.claude/skills/
# Commit only the docs/ files to the project repo.
# The skill files in ~/.claude/skills/ do not need a git commit (user-local files).
```

- [ ] **Step 2: Stage and commit the spec + plan docs**

```bash
cd "C:/temp/n8n/n8n-nodes-autotask"
git add docs/superpowers/specs/2026-03-13-n8n-add-ai-tools-v2-design.md
git add docs/superpowers/plans/2026-03-13-n8n-add-ai-tools-v2.md
git commit -m "$(cat <<'EOF'
docs: add v2 design spec and implementation plan for n8n-add-ai-tools skill

Captures the full design and execution plan for the skill rewrite:
11 requirements addressed including self-contained pre-flight, three-layer
write safety, stable result envelope, hardened runtime anchor, and
promoted discoveries.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Confirm commit succeeded**

```bash
git -C "C:/temp/n8n/n8n-nodes-autotask" log --oneline -3
# Expected: new commit at top
```

---

## Quick Reference: Acceptance Criteria Summary

| # | Criterion | File | Check |
|---|---|---|---|
| 1 | Compatibility matrix first | skill.md | grep "2.10.x" in first 30 lines |
| 2 | No mandatory Skill() calls | skill.md | grep "Invoke.*upfront" = 0 |
| 3 | Three-layer write safety | skill.md | grep "Layer 1\|Layer 2\|Layer 3" ≥ 3 |
| 4 | WRITE_OPERATION_BLOCKED error | skill.md | grep "WRITE_OPERATION_BLOCKED" ≥ 2 |
| 5 | ANCHOR_CANDIDATES + fail-fast | skill.md | grep "ANCHOR_CANDIDATES" ≥ 1 |
| 6 | Tool name regex in QA | skill.md | grep "a-zA-Z0-9_-" ≥ 1 |
| 7 | Current/Future-Ready in Step 9 | skill.md | grep "Future-Ready" ≥ 1 |
| 8 | wrapSuccess/wrapError exported | code-templates.md | grep "export function wrap" = 2 |
| 9 | StructuredToolError retired | code-templates.md | grep "interface StructuredToolError" = 0 |
| 10 | resource in all responses | code-templates.md | grep "wrapSuccess.*resource" ≥ 3 |
| 11 | items not results in getAll | code-templates.md | grep '"items"' ≥ 1 |
| 12 | helper-tools exception documented | code-templates.md | grep "plain JSON" ≥ 1 |
| 13 | 6 discoveries marked promoted | discoveries.md | grep "promoted" = 6 |
| 14 | Discoveries header present | discoveries.md | grep "safety-critical" ≥ 1 |
| 15 | No active discoveries | discoveries.md | grep "Status.*active" = 0 |
| 16 | Queue-mode caveat × 2 | skill.md | grep "single worker" ≥ 2 |
| 17 | npm run build in Step 11 | skill.md | grep "npm run build" ≥ 1 |
