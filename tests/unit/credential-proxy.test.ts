// tests/unit/credential-proxy.test.ts
import { describe, it, expect } from 'vitest';

describe('parseAndValidateHeaders', () => {
  it('returns OverrideAutotaskCredentials on valid complete headers', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const headers = {
      'x-autotask-username': 'user@example.com',
      'x-autotask-secret': 'secretpass',
      'x-autotask-integrationcode': 'abc123',
      'x-autotask-zone': 'https://webservices6.autotask.net/atservicesrest/',
    };
    const result = parseAndValidateHeaders(headers);
    expect(result.type).toBe('ok');
    if (result.type === 'ok') {
      expect(result.creds.Username).toBe('user@example.com');
      expect(result.creds.zone).toBe('https://webservices6.autotask.net/atservicesrest'); // normalised
    }
  });

  it('returns none when all four headers absent', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({});
    expect(result.type).toBe('none');
  });

  it('returns error on partial headers (3 of 4)', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'u',
      'x-autotask-secret': 's',
      'x-autotask-integrationcode': 'c',
    });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toMatch(/missing/i);
    }
  });

  it('rejects zone URL not matching allowlist', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'u',
      'x-autotask-secret': 's',
      'x-autotask-integrationcode': 'c',
      'x-autotask-zone': 'http://169.254.169.254/latest/meta-data/',
    });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toMatch(/zone/i);
    }
  });

  it('rejects zone with non-HTTPS scheme', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'u',
      'x-autotask-secret': 's',
      'x-autotask-integrationcode': 'c',
      'x-autotask-zone': 'ftp://webservices6.autotask.net/atservicesrest',
    });
    expect(result.type).toBe('error');
  });

  it('rejects header value with control character', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'user\r\nevil',
      'x-autotask-secret': 's',
      'x-autotask-integrationcode': 'c',
      'x-autotask-zone': 'https://webservices6.autotask.net/atservicesrest',
    });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toMatch(/invalid characters/i);
    }
  });

  it('rejects header value exceeding 1024 chars', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'u'.repeat(1025),
      'x-autotask-secret': 's',
      'x-autotask-integrationcode': 'c',
      'x-autotask-zone': 'https://webservices6.autotask.net/atservicesrest',
    });
    expect(result.type).toBe('error');
  });

  it('accepts unicode characters in header values', async () => {
    const { parseAndValidateHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = parseAndValidateHeaders({
      'x-autotask-username': 'josé@example.com',
      'x-autotask-secret': 'naïve123',
      'x-autotask-integrationcode': 'abc123',
      'x-autotask-zone': 'https://webservices6.autotask.net/atservicesrest',
    });
    expect(result.type).toBe('ok');
    if (result.type === 'ok') {
      expect(result.creds.Username).toBe('josé@example.com');
    }
  });
});

describe('normaliseIncomingHeaders', () => {
  it('lowercases header names', async () => {
    const { normaliseIncomingHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = normaliseIncomingHeaders({ 'X-Autotask-Username': 'u', 'X-AUTOTASK-SECRET': 's' });
    expect(result['x-autotask-username']).toBe('u');
    expect(result['x-autotask-secret']).toBe('s');
  });

  it('takes first value when header is array', async () => {
    const { normaliseIncomingHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = normaliseIncomingHeaders({ 'x-autotask-username': ['first', 'second'] });
    expect(result['x-autotask-username']).toBe('first');
  });

  it('skips undefined values', async () => {
    const { normaliseIncomingHeaders } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const result = normaliseIncomingHeaders({ 'x-autotask-username': undefined });
    expect('x-autotask-username' in result).toBe(false);
  });
});

describe('buildCredentialProxy', () => {
  it('getCredentials returns override for autotaskApi', async () => {
    const { buildCredentialProxy } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const override = Object.freeze({ Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' });

    const mockContext = {
      getCredentials: async (_name: string) => ({ Username: 'configured', Secret: 'conf-secret', zone: 'configured-zone' }),
    };

    const proxied = buildCredentialProxy(mockContext as any, override);
    const result = await proxied.getCredentials('autotaskApi');
    expect((result as any).Username).toBe('u');
    expect((result as any).Secret).toBe('s');
  });

  it('getCredentials delegates to original for other credential names', async () => {
    const { buildCredentialProxy } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const override = Object.freeze({ Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' });
    const original = { Username: 'other-configured' };

    const mockContext = {
      getCredentials: async (name: string) => (name === 'someOtherCred' ? original : null),
    };

    const proxied = buildCredentialProxy(mockContext as any, override);
    const result = await proxied.getCredentials('someOtherCred');
    expect(result).toBe(original);
  });

  it('proxy forwards all getCredentials args', async () => {
    const { buildCredentialProxy } = await import('../../nodes/Autotask/helpers/credential-proxy');
    const override = Object.freeze({ Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' });
    let capturedArgs: unknown[] = [];

    const mockContext = {
      getCredentials: async (...args: unknown[]) => { capturedArgs = args; return null; },
    };

    const proxied = buildCredentialProxy(mockContext as any, override);
    await proxied.getCredentials('otherCred' as any, 5 as any); // itemIndex = 5
    expect(capturedArgs[0]).toBe('otherCred');
    expect(capturedArgs[1]).toBe(5);
  });
});
