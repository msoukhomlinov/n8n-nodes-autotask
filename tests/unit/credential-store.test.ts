// tests/unit/credential-store.test.ts
import { describe, it, expect } from 'vitest';
import { AsyncLocalStorage } from 'async_hooks';

describe('autotaskCredentialStore singleton', () => {
  it('returns same instance on repeated import', async () => {
    const mod1 = await import('../../nodes/Autotask/helpers/credential-store');
    const mod2 = await import('../../nodes/Autotask/helpers/credential-store');
    expect(mod1.autotaskCredentialStore).toBe(mod2.autotaskCredentialStore);
  });

  it('is an AsyncLocalStorage', async () => {
    const { autotaskCredentialStore } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(autotaskCredentialStore).toBeInstanceOf(AsyncLocalStorage);
  });

  it('getStore returns undefined outside run()', async () => {
    const { autotaskCredentialStore } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(autotaskCredentialStore.getStore()).toBeUndefined();
  });

  it('getStore returns value inside run()', async () => {
    const { autotaskCredentialStore } = await import('../../nodes/Autotask/helpers/credential-store');
    const creds = { Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' };
    let stored: unknown;
    await new Promise<void>(resolve => {
      autotaskCredentialStore.run(Object.freeze(creds), () => {
        stored = autotaskCredentialStore.getStore();
        resolve();
      });
    });
    expect(stored).toEqual(creds);
  });
});

describe('requestHeaderStore singleton', () => {
  it('returns same instance on repeated import', async () => {
    const mod1 = await import('../../nodes/Autotask/helpers/credential-store');
    const mod2 = await import('../../nodes/Autotask/helpers/credential-store');
    expect(mod1.requestHeaderStore).toBe(mod2.requestHeaderStore);
  });

  it('is an AsyncLocalStorage', async () => {
    const { requestHeaderStore } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(requestHeaderStore).toBeInstanceOf(AsyncLocalStorage);
  });

  it('getStore returns headers inside run()', async () => {
    const { requestHeaderStore } = await import('../../nodes/Autotask/helpers/credential-store');
    const headers = { 'x-autotask-username': 'u' };
    let stored: unknown;
    await new Promise<void>(resolve => {
      requestHeaderStore.run(headers, () => {
        stored = requestHeaderStore.getStore();
        resolve();
      });
    });
    expect(stored).toEqual(headers);
  });
});

describe('normaliseZone', () => {
  it('strips trailing slash', async () => {
    const { normaliseZone } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(normaliseZone('https://webservices6.autotask.net/atservicesrest/')).toBe(
      'https://webservices6.autotask.net/atservicesrest'
    );
  });

  it('strips multiple trailing slashes', async () => {
    const { normaliseZone } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(normaliseZone('https://webservices6.autotask.net/atservicesrest///')).toBe(
      'https://webservices6.autotask.net/atservicesrest'
    );
  });

  it('leaves URL without trailing slash unchanged', async () => {
    const { normaliseZone } = await import('../../nodes/Autotask/helpers/credential-store');
    expect(normaliseZone('https://webservices6.autotask.net/atservicesrest')).toBe(
      'https://webservices6.autotask.net/atservicesrest'
    );
  });
});

describe('probe cache', () => {
  it('probeCredentialIdentity returns 16-char hex string', async () => {
    const { probeCredentialIdentity } = await import('../../nodes/Autotask/helpers/credential-store');
    const creds = { Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' };
    const id = probeCredentialIdentity(creds);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('two different secrets produce different identity', async () => {
    const { probeCredentialIdentity } = await import('../../nodes/Autotask/helpers/credential-store');
    const a = probeCredentialIdentity({ Username: 'u', Secret: 's1', APIIntegrationcode: 'c', zone: 'https://ws.test' });
    const b = probeCredentialIdentity({ Username: 'u', Secret: 's2', APIIntegrationcode: 'c', zone: 'https://ws.test' });
    expect(a).not.toBe(b);
  });

  it('trailing-slash zone and non-trailing-slash produce same identity', async () => {
    const { probeCredentialIdentity } = await import('../../nodes/Autotask/helpers/credential-store');
    const a = probeCredentialIdentity({ Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test/path/' });
    const b = probeCredentialIdentity({ Username: 'u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test/path' });
    expect(a).toBe(b);
  });

  it('probeCredentials caches positive result and avoids second http call', async () => {
    const { probeCredentials } = await import('../../nodes/Autotask/helpers/credential-store');
    const creds = { Username: 'cache-test-u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' };
    let calls = 0;
    const http = async () => { calls += 1; return {}; };
    expect(await probeCredentials(creds, http)).toBe(true);
    expect(await probeCredentials(creds, http)).toBe(true);
    expect(calls).toBe(1);
  });

  it('probeCredentials returns false and caches negative on 401', async () => {
    const { probeCredentials } = await import('../../nodes/Autotask/helpers/credential-store');
    const creds = { Username: 'neg-u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' };
    let calls = 0;
    const http = async () => { calls += 1; const e: any = new Error('unauth'); e.statusCode = 401; throw e; };
    expect(await probeCredentials(creds, http)).toBe(false);
    expect(await probeCredentials(creds, http)).toBe(false);
    expect(calls).toBe(1);
  });

  it('probeCredentials does not cache network errors (allows retry)', async () => {
    const { probeCredentials } = await import('../../nodes/Autotask/helpers/credential-store');
    const creds = { Username: 'net-u', Secret: 's', APIIntegrationcode: 'c', zone: 'https://ws.test' };
    let calls = 0;
    const http = async () => { calls += 1; const e: any = new Error('ECONNREFUSED'); throw e; };
    expect(await probeCredentials(creds, http)).toBe(true);
    expect(await probeCredentials(creds, http)).toBe(true);
    expect(calls).toBe(2);
  });
});
