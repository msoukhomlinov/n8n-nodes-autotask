import type { McpTestClient } from '../mcp-client';
import type { SharedFixtures } from './shared-fixtures';

export interface TestCase {
  /** Unique name within the fixture factory. Must be stable — used as test identity. */
  name: string;
  /** MCP tool args to pass via client.callTool(toolName, args). */
  args: Record<string, unknown>;
  /** Assertion function run against the tool response. */
  assert: (response: Record<string, unknown>) => void;
  /**
   * Guards evaluated at runtime. If any returns { ok: false }, the case is
   * skipped with console.warn. Use `requires` from shared-fixtures.ts.
   */
  requires?: Array<(fx: SharedFixtures) => { ok: true } | { ok: false; reason: string }>;
  /** When true, the case is skipped on read-only endpoints and enumerated by readonly.test.ts. */
  isWrite?: boolean;
  /**
   * Optional teardown. Called after assert passes, only when endpoint.kind === 'baseline'.
   * Use for create+delete write cases (requires TEST_SAFE_DELETE=true).
   */
  cleanup?: (ctx: {
    client: McpTestClient;
    fx: SharedFixtures;
    response: Record<string, unknown>;
  }) => Promise<void>;
}

/** A function that produces test cases from shared fixtures. */
export type FixtureFactory = (fx: SharedFixtures) => TestCase[];

/** Descriptor passed to registerResourceSuite(). */
export interface ResourceSuiteDescriptor {
  /** Resource name, e.g. 'ticketNote'. Used in describe block label. */
  resource: string;
  /** MCP tool name, e.g. 'autotask_ticketNote'. */
  toolName: string;
  /** Factory producing test cases from SharedFixtures. */
  cases: FixtureFactory;
}
