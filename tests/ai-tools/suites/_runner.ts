import { describe, it, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { loadEndpointConfigs } from '../test-config';
import type { EndpointConfig } from '../test-config';
import { buildSharedFixtures, dryRunStub } from '../context/shared-fixtures';
import type { SharedFixtures } from '../context/shared-fixtures';
import type { ResourceSuiteDescriptor, TestCase } from '../context/types';

export { ResourceSuiteDescriptor };

export function registerResourceSuite(desc: ResourceSuiteDescriptor): void {
  const endpointConfigs = loadEndpointConfigs();

  describe.each(endpointConfigs)(`${desc.resource} — $name`, (endpoint: EndpointConfig) => {
    const client = new McpTestClient();

    // Describe-time: single stub, produces stable test names before beforeAll runs.
    const stub = dryRunStub(endpoint);
    const stubCases = desc.cases(stub);

    // Runtime state — populated in beforeAll, reused by all it() blocks.
    let fx: SharedFixtures = stub;
    let liveCases: TestCase[] = [];

    beforeAll(async () => {
      await client.connect(endpoint.url);
      fx = await buildSharedFixtures(client, endpoint);
      for (const warning of fx.warnings) {
        console.warn(`[${endpoint.name}/${desc.resource}] ${warning}`);
      }
      liveCases = desc.cases(fx);
    });

    afterAll(async () => {
      await client.disconnect();
    });

    for (const stubCase of stubCases) {
      it(stubCase.name, async () => {
        const liveCase = liveCases.find((c) => c.name === stubCase.name);
        if (!liveCase) {
          throw new Error(
            `[${desc.resource}] Internal: live case "${stubCase.name}" not found. ` +
            `Ensure FixtureFactory returns a case with this exact name for all fixture inputs.`
          );
        }

        // Evaluate requires[] guards using the real fx from beforeAll.
        if (liveCase.requires) {
          for (const guard of liveCase.requires) {
            const result = guard(fx);
            if (!result.ok) {
              console.warn(`[${endpoint.name}/${desc.resource}] Skipping "${liveCase.name}" — ${result.reason}`);
              return;
            }
          }
        }

        // Skip write cases on read-only endpoints.
        if (endpoint.isReadOnly && liveCase.isWrite) {
          console.warn(
            `[${endpoint.name}/${desc.resource}] Skipping "${liveCase.name}" — read-only mode: skipping write case`
          );
          return;
        }

        const response = await client.callTool(desc.toolName, liveCase.args);
        liveCase.assert(response);

        // Cleanup only runs on baseline endpoints to avoid double-teardown.
        if (liveCase.cleanup && endpoint.kind === 'baseline') {
          await liveCase.cleanup({ client, fx, response });
        }
      });
    }
  });
}
