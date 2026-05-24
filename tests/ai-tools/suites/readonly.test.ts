/**
 * Write-block assertion suite.
 *
 * Runs ONLY when:
 *   - MCP_ENDPOINT_READONLY is set and a 'readonly' kind endpoint is returned
 *     by loadEndpointConfigs()
 *   - TEST_READ_ONLY_MODE is false (default)
 *
 * When TEST_READ_ONLY_MODE=true (single-URL read-only mode), this suite does
 * NOT run — the runner already skips write cases silently and no WRITE_OPERATION_BLOCKED
 * assertion is appropriate.
 *
 * Enumerates all isWrite:true cases from every fixture factory and asserts that
 * calling them against the readonly endpoint returns WRITE_OPERATION_BLOCKED.
 * No changes needed here when a new resource is added — update _index.ts only.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { loadEndpointConfigs, isReadOnlyMode } from '../test-config';
import { dryRunStub } from '../context/shared-fixtures';
import { assertErrorShape } from '../assertions/response-shape';
import { allFixtureRegistrations } from '../fixtures/_index';

const readonlyEndpoint = loadEndpointConfigs().find((c) => c.kind === 'readonly');

// Vitest requires at least one suite per file; this placeholder satisfies that when the
// write-block suite is inactive (read-only mode or no readonly endpoint configured).
if (!readonlyEndpoint || isReadOnlyMode()) {
  describe.skip('write-block assertions — skipped (no readonly endpoint or TEST_READ_ONLY_MODE=true)', () => {
    it.skip('placeholder', () => {});
  });
}

if (readonlyEndpoint && !isReadOnlyMode()) {
  describe('write-block assertions — readonly endpoint', () => {
    const client = new McpTestClient();

    beforeAll(async () => {
      await client.connect((readonlyEndpoint as NonNullable<typeof readonlyEndpoint>).url);
    });

    afterAll(async () => {
      await client.disconnect();
    });

    for (const reg of allFixtureRegistrations) {
      const writeCases = reg.factory(dryRunStub()).filter((tc) => tc.isWrite === true);

      for (const tc of writeCases) {
        it(`${reg.toolName}: ${tc.name}`, async () => {
          const response = await client.callTool(reg.toolName, tc.args);
          assertErrorShape(response, 'WRITE_OPERATION_BLOCKED');
        });
      }
    }
  });
}
