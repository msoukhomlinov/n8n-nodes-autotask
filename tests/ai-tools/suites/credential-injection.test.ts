import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { McpTestClient } from '../mcp-client';

// These tests only run when a credential-injection endpoint is configured.
const INJECTION_URL = process.env.TEST_INJECTION_ENDPOINT_URL;
const AT_USERNAME = process.env.TEST_AT_OVERRIDE_USERNAME;
const AT_SECRET = process.env.TEST_AT_OVERRIDE_SECRET;
const AT_CODE = process.env.TEST_AT_OVERRIDE_CODE;
const AT_ZONE = process.env.TEST_AT_OVERRIDE_ZONE;

const CONFIGURED = !!(INJECTION_URL && AT_USERNAME && AT_SECRET && AT_CODE && AT_ZONE);

describe.skipIf(!CONFIGURED)('credential injection — autotask mcp trigger', () => {
    const client = new McpTestClient('streamable-http');
    const headers = {
        'X-Autotask-Username': AT_USERNAME!,
        'X-Autotask-Secret': AT_SECRET!,
        'X-Autotask-IntegrationCode': AT_CODE!,
        'X-Autotask-Zone': AT_ZONE!,
    };

    beforeAll(async () => {
        await client.connect(INJECTION_URL!, headers);
    });

    afterAll(async () => {
        await client.disconnect();
    });

    it('describeFields returns fields under override credential', async () => {
        const result = await client.callTool('autotask_ticket', { operation: 'describeFields' });
        const parsed = JSON.parse(typeof result === 'string' ? result : JSON.stringify(result));
        expect(parsed.fields).toBeDefined();
        expect(Array.isArray(parsed.fields)).toBe(true);
        expect(parsed.fields.length).toBeGreaterThan(0);
    });

    it('response does not contain credential values', async () => {
        const result = await client.callTool('autotask_ticket', { operation: 'describeFields' });
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        // Secret and integration code must not appear verbatim in any response
        expect(text).not.toContain(AT_SECRET!);
        expect(text).not.toContain(AT_CODE!);
    });
});

describe.skipIf(!INJECTION_URL)('credential injection — rejection cases', () => {
    it('returns PERMISSION_DENIED for invalid credentials', async () => {
        const client = new McpTestClient('streamable-http');
        const badHeaders = {
            'X-Autotask-Username': 'invalid@example.com',
            'X-Autotask-Secret': 'wrongpassword123',
            'X-Autotask-IntegrationCode': 'wrongcode456',
            'X-Autotask-Zone': 'https://webservices6.autotask.net/atservicesrest',
        };
        await client.connect(INJECTION_URL!, badHeaders);
        const result = await client.callTool('autotask_ticket', { operation: 'describeFields' });
        const parsed = JSON.parse(typeof result === 'string' ? result : JSON.stringify(result));
        expect(parsed.error).toBe(true);
        expect(parsed.errorType).toBe('PERMISSION_DENIED');
        await client.disconnect();
    });
});
