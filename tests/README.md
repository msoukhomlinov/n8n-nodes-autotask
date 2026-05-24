# Autotask AI Tools — Integration Tests

Live integration tests for the `AutotaskAiTools` node via a running n8n MCP Trigger endpoint.

**Coverage path:** `supplyData() → func()` (MCP Trigger, Agent V2/legacy).
**Not covered:** Agent V3 `execute()` path — requires direct n8n workflow invocation.

---

## Prerequisites

1. n8n running with an **AutotaskAiTools** node configured for your Autotask sandbox
2. An **MCP Trigger** node wired to that tool node, with the workflow **active**
3. A known ticket ID in the sandbox (with `ticketNumber` populated and SLA configured)
4. A known company name that has tickets

---

## Setup

```bash
cd tests
cp .env.test.example .env.test
# Edit .env.test — fill in all required values
npx pnpm install
```

### `.env.test` variables

| Variable | Required | Description |
|---|---|---|
| `MCP_ENDPOINT_BASELINE` | **Yes*** | MCP Trigger URL for the primary workflow |
| `MCP_ENDPOINT_READONLY` | No | Endpoint with `allowWriteOperations=false`. Two uses: (1) alongside baseline → `readonly.test.ts` runs write-block assertions; (2) alone with `TEST_READ_ONLY_MODE=true` → sole endpoint, all writes skipped |
| `MCP_TRANSPORT` | No | `sse` (default) or `streamable-http` |
| `TEST_READ_ONLY_MODE` | No | `true` → skip all write cases |
| `TEST_TICKET_ID` | **Yes** | Numeric ID of a known-good ticket (needs `ticketNumber` + SLA) |
| `TEST_TICKET_NUMBER` | No | Overrides auto-derived ticket number (normally not needed) |
| `TEST_COMPANY_NAME` | No | Exact company name for label-resolution tests. If unset, those cases skip |
| `TEST_COMPANY_NAME_2` | No | Second company for cross-client eval scenarios |
| `TEST_COMPANY_NAME_3` | No | Third company for additional eval variety |
| `TEST_COMPANY_ID` | No | Override derived `companyID` from pivot ticket |
| `TEST_CONTACT_ID` | No | Override derived `contactID` from pivot ticket |
| `TEST_RESOURCE_ID` | No | Override derived `assignedResourceID` / `whoAmI` result |
| `TEST_TICKET_NOTE_ID` | No | Known-good ticket note ID. Derived at runtime if unset |
| `TEST_TIME_ENTRY_ID` | No | Known-good time entry ID. Derived at runtime if unset |
| `TEST_TICKET_ID_2` | No | Second ticket ID for multi-ticket eval scenarios |
| `LM_STUDIO_HOST` | No | LM Studio hostname/IP (default: `192.168.253.143`) |
| `LM_STUDIO_PORT` | No | LM Studio port (default: `1234`) |
| `EVAL_MODEL` | No | Model ID as shown in LM Studio (default: `qwen3.6-35b-a3b`) |

*`MCP_ENDPOINT_BASELINE` can be omitted when `MCP_ENDPOINT_READONLY` + `TEST_READ_ONLY_MODE=true` are both set.

---

## Running

```bash
# All integration tests (evals excluded) — ~2 min
pnpm test

# Watch mode
pnpm test:watch

# LLM behavioral evals — requires LM Studio (see Evals section)
pnpm test:evals

# Single scenario for debugging
node node_modules/vitest/vitest.mjs run --config vitest.evals.config.ts -t "ticket-meta-001"
```

Integration tests run sequentially with a 45 s per-test timeout. Eval tests use a separate config (`vitest.evals.config.ts`) with a 5-minute per-test timeout.

---

## Current test inventory

### Integration tests (`pnpm test`) — 6 resources, ~80 cases total

| Resource | Cases | Notes |
|---|---|---|
| ticket | 35 | Full coverage: getMany, count, get, slaHealthCheck, summary, create, update, delete, notes, returnAll, recency |
| ticketNote | 11 | getMany, filtersJson, get, create (write-gated) |
| timeEntry | 9 | getUnposted, getMany, get, createIfNotExists (write-gated) |
| company | 11 | getMany, filtersJson, count, label-resolution, get |
| contact | 9 | getMany by company, filtersJson, get |
| resource | 11 | whoAmI, getMany, filtersJson, count, get |

Plus `pagination.test.ts` (2 multi-step traversal tests) and `readonly.test.ts` (write-block assertions across all resources).

### Eval tests (`pnpm test:evals`) — 55 LLM behavioral scenarios

`evals/ticket.yaml` — 7 existing + 6 new personas:

| Persona slug | Count | Focus |
|---|---|---|
| `any` | 3 | Metadata orientation (describeFields, listPicklistValues, describeOperation) |
| `sdm` | 5 | Queue visibility, unassigned tickets, SLA risk, open counts |
| `engineer-own` | 3 | Own ticket queue, priority triage, staleness |
| `engineer-handover` | 4 + 5 multi-step | Full ticket detail, SLA, summary, title search |
| `am-qbr` | 4 | Quarterly prep, high-priority history, count, groupBy limitation |
| `am-bau` | 3 | Daily client monitoring, status disambiguation |
| `l1-l2-engineer` | 6 | New ticket queue, unassigned pickup, pattern lookup, status decode |
| `senior-engineer` | 6 | Breach detection, escalation field discovery, recurring-issue review |
| `service-desk-manager` | 6 | Workload groupBy limitation, breach window, closure counts, long-pending |
| `account-manager` | 6 | Pre-call brief, ticket aging, critical history, volume trends |
| `sales-support` | 6 | Renewal diligence, breach history, category breakdown, onboarding ramp |
| `owner` | 6 | Monthly totals, breach count, QoQ trends, team-level KPIs |
| multi-step | 5 | Cross-operation chains (getMany → slaHealthCheck, oldest → summary, etc.) |

---

## LLM Behavioral Evals — current state and how to continue

### How the pipeline works

1. `evals.test.ts` reads `ticket.yaml`, substitutes `{TEST_COMPANY_NAME}` / `{TEST_TICKET_NUMBER}` etc. from env
2. For each scenario: sends `question` to LM Studio (Qwen), executes tool calls against the live MCP endpoint (up to 10 turns), judges final response against `successDefinition` using the same model
3. Pass/fail printed per scenario with tool call trace and judge reasoning on failure

### Validation status

Two scenarios fully validated as of last session:

| Scenario | Status | Notes |
|---|---|---|
| `ticket-meta-001` | ✅ PASS | `describeFields mode=read` |
| `ticket-meta-002` | ✅ PASS | `listPicklistValues fieldId=status` |
| `ticket-meta-003` … `ticket-multi-006` | ❓ Not yet run | Remaining 53 scenarios |

### Known property name mismatches to watch for

The successDefinitions were generated by an LLM that assumed idealized response shapes. Two systematic mismatches already corrected; others may exist in the remaining 53 scenarios:

| What the AI assumed | Actual property in response | Where it matters |
|---|---|---|
| `label` on field entries | `name` | `describeFields` responses |
| `value` on picklist entries | `id` | `listPicklistValues` responses |
| `isActive` on picklist entries | Not present (pre-filtered to active) | `listPicklistValues` responses |
| `required=true` on read fields | Never set (read filters are all optional) | `describeFields mode=read` |

**Pattern for fixing failures:** when a scenario FAILs, the judge reasoning will name the missing property. Cross-check against `nodes/Autotask/helpers/aiHelper.ts` (the `FieldMeta` object and `listPicklistValues` return shape) — these are the ground truth.

### How to continue validation

Run scenarios sequentially (one at a time is easiest for triage):

```bash
# Single scenario
node node_modules/vitest/vitest.mjs run --config vitest.evals.config.ts -t "ticket-meta-003"

# All metadata scenarios
node node_modules/vitest/vitest.mjs run --config vitest.evals.config.ts -t "ticket-meta"

# Full suite (slow — ~55 × 2 min each at 25-30 tok/s)
pnpm test:evals
```

For each FAIL:
1. Read the judge reasoning in the output
2. Check actual response shape in `aiHelper.ts` or by running the same tool call via `pnpm test -t "<unit test name>"`
3. Fix the `successDefinition` in `ticket.yaml`
4. Re-run to confirm PASS
5. Commit to private git: `git --git-dir=.private-git --work-tree=. add -f tests/ai-tools/evals/ticket.yaml`

### How to add new eval scenarios

Add to `ticket.yaml`:

```yaml
- id: ticket-<persona>-<NNN>
  persona: <persona-slug>
  question: "natural language question using {TEST_COMPANY_NAME} not fictitious names"
  successDefinition: >
    LLM calls <operation>. Response contains <top-level key> non-empty.
    Each entry has <actual property names from aiHelper.ts>.
    Summary states <what>. LLM must NOT <anti-pattern>.
```

Template vars available: `{TEST_COMPANY_NAME}`, `{TEST_COMPANY_NAME_2}`, `{TEST_COMPANY_NAME_3}`, `{TEST_TICKET_NUMBER}`. Scenarios with unset vars are automatically skipped (not failed).

### Improving eval quality

**Set `TEST_COMPANY_NAME_2`** in `.env.test` — enables 15+ cross-client scenarios (senior-engineer, sales-support, owner personas) that currently skip.

**Increase judge accuracy:** the judge uses the same model as the subject. A stronger/separate judge model would reduce false negatives. To change, add a `EVAL_JUDGE_MODEL` env var and thread it through `eval-runner.ts:chatCompletion`.

**Extend to other resources:** create `evals/company.yaml`, `evals/timeEntry.yaml` etc. following the same format. The runner (`evals.test.ts`) only reads `ticket.yaml` today — it would need a loop over multiple files.

---

## Structure

```
tests/
  .env.test                  Live config (private git only — never commit to public repo)
  .env.test.example          Template with all variables documented
  setup.ts                   Loads .env.test via dotenv before suite runs
  vitest.config.ts           Default config — includes ai-tools/**/*.test.ts, excludes evals
  vitest.evals.config.ts     Eval-only config — 5 min timeout, no exclude
  package.json               Isolated package (npx pnpm)

  ai-tools/
    test-config.ts           loadEndpointConfigs() — URL resolution + EndpointKind/isReadOnly
    mcp-client.ts            McpTestClient — wraps @modelcontextprotocol/sdk; exposes availableTools[]

    context/
      shared-fixtures.ts     SharedFixtures, buildSharedFixtures(), dryRunStub(), requires guards
      types.ts               TestCase, FixtureFactory, ResourceSuiteDescriptor

    assertions/
      response-shape.ts      Assertion helpers: list, item, error, mutation, compound, SLA, etc.

    fixtures/
      _common.ts             commonMetadataCases(), commonErrorCases()
      _list.ts               listOperationCases()
      _index.ts              allFixtureRegistrations[] — used by readonly.test.ts
      ticket.ts              35+ cases
      ticketNote.ts          11 cases
      timeEntry.ts           9 cases
      company.ts             11 cases
      contact.ts             9 cases
      resource.ts            11 cases

    suites/
      _runner.ts             registerResourceSuite() — shared describe.each lifecycle
      ticket.test.ts
      ticketNote.test.ts
      timeEntry.test.ts
      company.test.ts
      contact.test.ts
      resource.test.ts
      readonly.test.ts       Write-block assertions (readonly endpoint only)
      pagination.test.ts     Multi-step nextOffset traversal (ticket + company)
      evals.test.ts          LLM behavioral evals — excluded from pnpm test

    evals/
      ticket.yaml            55 behavioral scenarios across 13 personas
      eval-runner.ts         LM Studio multi-turn loop + LLM judge
```

---

## Architecture

### FixtureFactory pattern

Each resource has `get<Resource>TestCases(fx: SharedFixtures): TestCase[]`. `SharedFixtures` is built once per endpoint in `beforeAll` via `buildSharedFixtures()`, which makes up to 4 API calls:

1. `autotask_ticket.get(TEST_TICKET_ID)` — ticketNumber, companyId, contactId, assignedResourceId
2. `autotask_resource.whoAmI` — currentResourceId, currentResourceEmail
3. `autotask_ticketNote.getMany` — ticketNoteId (lazy, skipped if `TEST_TICKET_NOTE_ID` set)
4. `autotask_timeEntry.getUnposted` — timeEntryId (lazy, skipped if `TEST_TIME_ENTRY_ID` set)

`buildSharedFixtures` never throws — errors go to `fx.warnings[]`, affected fields are `null`, cases with missing deps are skipped via `requires[]` guards.

### Two-pass test registration

Vitest collects test names at describe time before `beforeAll` runs. `registerResourceSuite` calls `desc.cases(dryRunStub())` at describe time for stable names, then `desc.cases(fx)` in `beforeAll` with real fixtures. Each `it()` looks up its case by name at runtime.

### Eval pipeline

```
evals.test.ts
  → applyStaticVars({TEST_COMPANY_NAME} etc.) at describe time
  → beforeAll: connect MCP, resolve TEST_TICKET_NUMBER from API if needed
  → it.each(scenarios): applyTicketNumber(), skip if any __MISSING_*__ var
  → runScenario() in eval-runner.ts:
      → mcpToOpenAITools(client.availableTools) — live tool schemas from MCP
      → loop: chatCompletion(LM Studio) → tool_calls → client.callTool(MCP) → repeat
      → judge: same model, no tools, PASS/FAIL on first line
```

---

## Adding a new resource (integration tests)

1. Add entity IDs to `SharedFixtures` + `buildSharedFixtures()` + `requires` in `context/shared-fixtures.ts`
2. Create `fixtures/<resource>.ts` with `get<Resource>TestCases(fx): TestCase[]`
3. Add to `fixtures/_index.ts` (`allFixtureRegistrations`)
4. Create `suites/<resource>.test.ts`:
   ```typescript
   import { registerResourceSuite } from './_runner';
   import { get<Resource>TestCases } from '../fixtures/<resource>';
   registerResourceSuite({ resource: '<resource>', toolName: 'autotask_<resource>', cases: get<Resource>TestCases });
   ```
5. Write cases: set `isWrite: true` on mutating cases, `requires[]` for fixture dependencies

---

## Endpoint variants

- **Baseline only:** full test suite including writes
- **Readonly only + `TEST_READ_ONLY_MODE=true`:** all tests, writes silently skipped — good for prod-like endpoints
- **Both:** full suite on baseline + write-block assertions on readonly (`readonly.test.ts`)
