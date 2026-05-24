/**
 * Pagination traversal tests — multi-step tests requiring two sequential API calls.
 * Cannot be expressed via the FixtureFactory pattern (assert() receives only the
 * first response, no client access). Each test manages its own call sequence inline.
 *
 * Runs against all configured endpoints.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { loadEndpointConfigs } from '../test-config';
import type { EndpointConfig } from '../test-config';
import {
  assertListShape,
  assertPaginationConsistent,
  assertCommonSuccessFields,
} from '../assertions/response-shape';

const endpointConfigs = loadEndpointConfigs();

describe.each(endpointConfigs)('pagination traversal — $name', (endpoint: EndpointConfig) => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect(endpoint.url);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('ticket getMany — nextOffset page 2 is valid', async () => {
    const page1 = await client.callTool('autotask_ticket', {
      operation: 'getMany',
      filter_field: 'status',
      filter_op: 'gt',
      filter_value: 0,
    });

    if (page1.error === true) {
      console.warn(`[${endpoint.name}/ticket] traversal skipped — page1 error: ${page1.errorType}`);
      return;
    }

    assertListShape(page1);
    assertPaginationConsistent(page1);
    assertCommonSuccessFields(page1);

    if (page1.hasMore !== true) {
      console.warn(`[${endpoint.name}/ticket] traversal skipped — hasMore=false (not enough records)`);
      return;
    }

    const nextOffset = page1.nextOffset as number;
    expect(nextOffset, 'nextOffset must be a positive integer when hasMore=true').toBeGreaterThan(0);

    const page2 = await client.callTool('autotask_ticket', {
      operation: 'getMany',
      filter_field: 'status',
      filter_op: 'gt',
      filter_value: 0,
      offset: nextOffset,
    });

    if (page2.error === true) {
      // Acceptable: offset hit MAX_QUERY_LIMIT ceiling or records exhausted
      expect(
        ['INVALID_FILTER_CONSTRAINT', 'NO_RESULTS_FOUND'].includes(page2.errorType as string),
        `page2 error must be INVALID_FILTER_CONSTRAINT or NO_RESULTS_FOUND, got: ${page2.errorType}`,
      ).toBe(true);
      return;
    }

    assertListShape(page2);
    assertPaginationConsistent(page2);
    assertCommonSuccessFields(page2);

    const p1Records = page1.records as Array<Record<string, unknown>>;
    const p2Records = page2.records as Array<Record<string, unknown>>;
    if (p1Records.length > 0 && p2Records.length > 0) {
      const p1Ids = new Set(p1Records.map((r) => r.id));
      const overlap = p2Records.filter((r) => p1Ids.has(r.id));
      expect(
        overlap.length,
        `page2 must not contain records from page1 (overlap: ${JSON.stringify(overlap.map((r) => r.id))})`,
      ).toBe(0);
    }
  });

  it('company getMany — nextOffset page 2 is valid', async () => {
    const page1 = await client.callTool('autotask_company', {
      operation: 'getMany',
      filter_field: 'id',
      filter_op: 'gt',
      filter_value: 0,
    });

    if (page1.error === true) {
      console.warn(`[${endpoint.name}/company] traversal skipped — page1 error: ${page1.errorType}`);
      return;
    }

    assertListShape(page1);
    assertPaginationConsistent(page1);
    assertCommonSuccessFields(page1);

    if (page1.hasMore !== true) {
      console.warn(`[${endpoint.name}/company] traversal skipped — hasMore=false (not enough records)`);
      return;
    }

    const nextOffset = page1.nextOffset as number;
    expect(nextOffset, 'nextOffset must be a positive integer when hasMore=true').toBeGreaterThan(0);

    const page2 = await client.callTool('autotask_company', {
      operation: 'getMany',
      filter_field: 'id',
      filter_op: 'gt',
      filter_value: 0,
      offset: nextOffset,
    });

    if (page2.error === true) {
      expect(
        ['INVALID_FILTER_CONSTRAINT', 'NO_RESULTS_FOUND'].includes(page2.errorType as string),
        `page2 error must be INVALID_FILTER_CONSTRAINT or NO_RESULTS_FOUND, got: ${page2.errorType}`,
      ).toBe(true);
      return;
    }

    assertListShape(page2);
    assertPaginationConsistent(page2);
    assertCommonSuccessFields(page2);

    const p1Records = page1.records as Array<Record<string, unknown>>;
    const p2Records = page2.records as Array<Record<string, unknown>>;
    if (p1Records.length > 0 && p2Records.length > 0) {
      const p1Ids = new Set(p1Records.map((r) => r.id));
      const overlap = p2Records.filter((r) => p1Ids.has(r.id));
      expect(
        overlap.length,
        `page2 must not contain records from page1 (overlap: ${JSON.stringify(overlap.map((r) => r.id))})`,
      ).toBe(0);
    }
  });
});
