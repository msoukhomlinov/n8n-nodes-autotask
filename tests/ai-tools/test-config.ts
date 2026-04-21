export type EndpointKind = 'baseline' | 'readonly';

export interface EndpointConfig {
  name: string;
  url: string;
  kind: EndpointKind;
  isReadOnly: boolean;  // true when TEST_READ_ONLY_MODE=true OR kind='readonly'
}

export function isReadOnlyMode(): boolean {
  return process.env.TEST_READ_ONLY_MODE?.toLowerCase() === 'true';
}

/**
 * Resolves 1-2 EndpointConfig entries from env vars.
 *
 * Resolution logic:
 *   - If MCP_ENDPOINT_BASELINE is set: use it as 'baseline'.
 *     If MCP_ENDPOINT_READONLY is also set (different URL): also add it as 'readonly'.
 *   - Else if MCP_ENDPOINT_READONLY is set AND TEST_READ_ONLY_MODE='true':
 *     use MCP_ENDPOINT_READONLY as sole endpoint with kind='readonly'.
 *   - Else: throw with a clear message.
 */
export function loadEndpointConfigs(): EndpointConfig[] {
  const baseline = process.env.MCP_ENDPOINT_BASELINE?.trim() || undefined;
  const readonlyUrl = process.env.MCP_ENDPOINT_READONLY?.trim() || undefined;
  const readOnlyMode = isReadOnlyMode();

  if (baseline) {
    const configs: EndpointConfig[] = [
      { name: 'baseline', url: baseline, kind: 'baseline', isReadOnly: readOnlyMode },
    ];
    if (readonlyUrl && readonlyUrl !== baseline) {
      configs.push({ name: 'readonly', url: readonlyUrl, kind: 'readonly', isReadOnly: true });
    }
    return configs;
  }

  if (readonlyUrl && readOnlyMode) {
    return [
      { name: 'readonly', url: readonlyUrl, kind: 'readonly', isReadOnly: true },
    ];
  }

  throw new Error(
    'MCP_ENDPOINT_BASELINE is required. ' +
    'Alternatively, set MCP_ENDPOINT_READONLY + TEST_READ_ONLY_MODE=true ' +
    'to run in read-only mode against a single endpoint. ' +
    'Copy tests/.env.test.example to tests/.env.test and fill in values.'
  );
}
