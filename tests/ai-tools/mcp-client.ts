import { Client } from '@modelcontextprotocol/sdk/client/index';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

export type TransportType = 'sse' | 'streamable-http';

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export class McpTestClient {
  private client: Client;
  private transportType: TransportType;
  public availableTools: McpToolSpec[] = [];

  constructor(
    transportType: TransportType = (process.env.MCP_TRANSPORT as TransportType) ?? 'sse'
  ) {
    this.transportType = transportType;
    this.client = new Client(
      { name: 'autotask-test-client', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  /**
   * Establishes the MCP connection and runs a tools/list health-check.
   * Throws if the server returns no tools — fails fast before test execution begins.
   */
  async connect(url: string, customHeaders?: Record<string, string>): Promise<void> {
    const parsedUrl = new URL(url);
    // StreamableHTTPClientTransport / SSEClientTransport accept a second options argument.
    // Recent SDK versions use `requestInit: { headers }`; older versions use `{ headers }`
    // directly. Provide both — the unused key is silently ignored.
    const transportOptions = customHeaders
      ? { requestInit: { headers: customHeaders }, headers: customHeaders }
      : undefined;
    const transport =
      this.transportType === 'streamable-http'
        ? new StreamableHTTPClientTransport(parsedUrl, transportOptions)
        : new SSEClientTransport(parsedUrl, transportOptions);

    await this.client.connect(transport);

    const tools = await this.client.listTools();
    if (!tools.tools || tools.tools.length === 0) {
      throw new Error(
        `MCP health check failed: no tools found at ${url}. ` +
        `Verify the n8n workflow is active and the MCP Trigger is enabled.`
      );
    }
    this.availableTools = tools.tools as McpToolSpec[];
  }

  /**
   * Sends a tools/call request and returns the parsed tool response.
   *
   * Prefers result.structuredContent when present (newer MCP versions).
   * Falls back to parsing content[0].text.
   *
   * Note: result.isError signals an MCP transport-level error, not a tool error.
   * Our tools always return structured JSON — even application errors come back
   * as { error: true, errorType, ... } inside content[0].text.
   * We parse unconditionally and let the caller's assertions surface the error shape.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const result = await this.client.callTool({ name, arguments: args });

    // result.isError signals an MCP transport-level error (e.g. server crash, protocol failure).
    // Application-level errors from our tools come back as { error: true, errorType, ... } in
    // structuredContent or content[0].text — those are expected and handled by assertions.
    if (result.isError === true) {
      throw new Error(
        `MCP transport error calling "${name}": ${JSON.stringify(result)}`
      );
    }

    if (
      result.structuredContent !== undefined &&
      result.structuredContent !== null &&
      typeof result.structuredContent === 'object'
    ) {
      return result.structuredContent as Record<string, unknown>;
    }

    const contentArray = result.content as Array<{ type: string; text?: string }> | undefined;
    const firstContent = contentArray?.[0];
    if (!firstContent) {
      throw new Error(
        `Tool call "${name}" returned no content. ` +
        `Raw result: ${JSON.stringify(result)}`
      );
    }
    if (firstContent.type !== 'text' || typeof firstContent.text !== 'string') {
      throw new Error(
        `Expected text content from "${name}", got type: "${firstContent.type}". ` +
        `Raw content: ${JSON.stringify(firstContent)}`
      );
    }
    const text = firstContent.text;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `Failed to parse tool response JSON from "${name}": ${e}\nRaw text: ${text}`
      );
    }
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
