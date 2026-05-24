/**
 * LLM behavioral evals — multi-turn tool-calling scenarios judged by the same model.
 *
 * Requires LM Studio running at LM_STUDIO_HOST (default: 192.168.253.143:1234)
 * with EVAL_MODEL loaded (default: qwen3.6-35b-a3b).
 *
 * Run explicitly:
 *   pnpm test:evals
 *
 * Excluded from default pnpm test — requires external LM Studio instance.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { join } from 'path';
import { McpTestClient } from '../mcp-client';
import { loadEndpointConfigs } from '../test-config';
import { runScenario } from '../evals/eval-runner';
import type { EndpointConfig } from '../test-config';

const endpointConfigs = loadEndpointConfigs();

interface EvalScenario {
  id: string;
  persona: string;
  question: string;
  successDefinition: string;
}

interface EvalFile {
  resource: string;
  scenarios: EvalScenario[];
}

// Static env vars — substituted at describe time (no API call needed)
const VARS: Record<string, string> = {
  TEST_COMPANY_NAME:   process.env.TEST_COMPANY_NAME   ?? '',
  TEST_COMPANY_NAME_2: process.env.TEST_COMPANY_NAME_2 ?? '',
  TEST_COMPANY_NAME_3: process.env.TEST_COMPANY_NAME_3 ?? '',
  TEST_RESOURCE_ID:    process.env.TEST_RESOURCE_ID    ?? '',
  TEST_TICKET_ID_2:    process.env.TEST_TICKET_ID_2    ?? '',
  // TEST_TICKET_NUMBER is resolved dynamically in beforeAll (may require API call)
};

function applyStaticVars(text: string): string {
  return text.replace(/\{(TEST_COMPANY_NAME(?:_\d)?|TEST_RESOURCE_ID|TEST_TICKET_ID_2)\}/g, (_match, key) => {
    return VARS[key] || `__MISSING_${key}__`;
  });
}

function applyTicketNumber(text: string, ticketNumber: string): string {
  return text.replace(/\{TEST_TICKET_NUMBER\}/g, ticketNumber || '__MISSING_TICKET_NUMBER__');
}

function hasMissingVar(text: string): string | null {
  const m = text.match(/__MISSING_([A-Z0-9_]+)__/);
  return m ? m[1] : null;
}

const rawScenarios = (
  parse(readFileSync(join(__dirname, '../evals/ticket.yaml'), 'utf-8')) as EvalFile
).scenarios;

describe.each(endpointConfigs)('evals — ticket — $name', (endpoint: EndpointConfig) => {
  const client = new McpTestClient('streamable-http');
  let resolvedTicketNumber = process.env.TEST_TICKET_NUMBER ?? '';

  beforeAll(async () => {
    await client.connect(endpoint.url);

    if (!resolvedTicketNumber && process.env.TEST_TICKET_ID) {
      try {
        const result = await client.callTool('autotask_ticket', {
          operation: 'get',
          id: Number(process.env.TEST_TICKET_ID),
        });
        if (!result.error) {
          resolvedTicketNumber = String((result.record as Record<string, unknown>)?.ticketNumber ?? '');
        }
      } catch {
        // leave empty — scenarios using {TEST_TICKET_NUMBER} will be skipped
      }
    }
  }, 30_000);

  afterAll(async () => {
    await client.disconnect();
  });

  // Apply static company vars at describe time; ticket number applied per-test after beforeAll
  const scenarios = rawScenarios.map((s) => ({
    ...s,
    question:          applyStaticVars(s.question),
    successDefinition: applyStaticVars(s.successDefinition),
  }));

  it.each(scenarios)('$id [$persona]', async (scenario) => {
    // Apply ticket number now (resolved in beforeAll)
    const question          = applyTicketNumber(scenario.question,          resolvedTicketNumber);
    const successDefinition = applyTicketNumber(scenario.successDefinition, resolvedTicketNumber);

    // Skip scenarios with unresolved vars
    const missingQ = hasMissingVar(question);
    const missingS = hasMissingVar(successDefinition);
    if (missingQ || missingS) {
      console.warn(`[${scenario.id}] Skipped — ${missingQ ?? missingS} not set in .env.test`);
      return;
    }

    const result = await runScenario(client, { id: scenario.id, question, successDefinition });

    const label = result.pass ? 'PASS' : 'FAIL';
    const toolSummary = result.toolCallTrace.filter((_, i) => i % 2 === 0).join(' | ');
    console.log(`[${scenario.id}] ${label} (${result.turnsUsed} turns)${toolSummary ? ` | ${toolSummary}` : ''}`);

    if (!result.pass) {
      console.log(`  Judge: ${result.judgeReasoning}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }

    expect(
      result.pass,
      [
        `Scenario ${scenario.id} FAILED`,
        `Judge: ${result.judgeReasoning}`,
        `Tools: ${toolSummary || '(none)'}`,
        result.error ? `Error: ${result.error}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ).toBe(true);
  }, 600_000); // 10 min per scenario — at 25-30 tok/s, complex 10-turn + judge ≈ 7-8 min
});
