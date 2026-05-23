/**
 * AutotaskMcpServer — MCP server that delegates tool calls to connected
 * n8n AI tools (e.g. AutotaskAiTools) and (optionally) injects per-user
 * Autotask credentials via AsyncLocalStorage on a per-request basis.
 *
 * Responsibilities:
 *   1. tools/list  → enumerate n8n AI tools (name, description, JSON-Schema input)
 *   2. tools/call  → invoke the underlying tool's .invoke(args) inside an ALS
 *                    context populated from the incoming HTTP request's headers
 *                    (when injectAutotaskCredentials is enabled).
 *   3. Transport binding for both SSE and Streamable HTTP servers.
 *
 * Concurrency / ALS contract:
 *   The McpServer instance is shared across concurrent HTTP requests. We never
 *   read headers from a shared property; instead each tools/call execution
 *   runs inside `requestHeaderStore.run(headers, ...)` set by the webhook
 *   handler, and the call handler reads via `requestHeaderStore.getStore()`.
 *
 * Runtime resolution:
 *   The @modelcontextprotocol/sdk is NOT a production dependency of this
 *   package. It is resolved lazily at first use via require.main (i.e. n8n's
 *   own node_modules — n8n ships it with n8n-nodes-langchain). This mirrors
 *   the @langchain/* / zod resolution strategy in ai-tools/runtime.ts.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { autotaskCredentialStore, requestHeaderStore, invalidateProbeCache, probeCredentialIdentity, probeCredentials, type OverrideAutotaskCredentials } from '../helpers/credential-store';
import { parseAndValidateHeaders } from '../helpers/credential-proxy';
import { wrapError, ERROR_TYPES } from '../ai-tools/error-formatter';

// ---------------------------------------------------------------------------
// Runtime-resolved SDK / zod-to-json-schema typings.
// We treat them as `any` at the boundary — strong typing comes from the
// helpers we own, not from a peer SDK whose exact version is not pinned.
// ---------------------------------------------------------------------------

interface McpToolDescriptor {
    /** Tool name as exposed to MCP clients. */
    name: string;
    /** Human-readable description. */
    description: string;
    /** JSON Schema for the tool input. */
    inputSchema: Record<string, unknown>;
    /** Internal invoker — accepts MCP tool-call args, returns the result string. */
    invoke: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Shape of a tool object supplied by an n8n `supplyData()` node (e.g.
 * `DynamicStructuredTool` from @langchain/core/tools). We only depend on the
 * minimal surface area: name, description, schema (Zod), and invoke().
 */
export interface N8nLikeTool {
    name: string;
    description?: string;
    schema: unknown; // Zod schema (or already JSON Schema in some adapters)
    invoke: (args: Record<string, unknown>) => Promise<string | unknown>;
}

export interface AutotaskMcpServerOptions {
    /** Service identity advertised to MCP clients. */
    serverInfo: { name: string; version: string };
    /** Tools to expose. Built fresh per request because invoke() closes over node context. */
    tools: N8nLikeTool[];
    /** When true, headers carrying X-Autotask-* are extracted and injected into tool calls. */
    injectAutotaskCredentials: boolean;
    /** HTTP request fn used for credential probing. Wrapper around n8n's helpers.httpRequest. */
    httpRequest: (opts: { method: string; url: string; headers: Record<string, string> }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Lazy SDK loader
// ---------------------------------------------------------------------------

interface LoadedMcpSdk {
    Server: any;
    SSEServerTransport: any;
    StreamableHTTPServerTransport: any;
    ListToolsRequestSchema: any;
    CallToolRequestSchema: any;
    zodToJsonSchema: (schema: unknown, opts?: unknown) => Record<string, unknown>;
}

let _sdk: LoadedMcpSdk | null = null;

function loadMcpSdk(): LoadedMcpSdk {
    if (_sdk) return _sdk;

    const { createRequire } = require('module') as { createRequire: (f: string) => NodeRequire };
    const errors: string[] = [];

    // Two-strategy resolution (same pattern as ai-tools/runtime.ts):
    //   1. require.main (n8n's process entry — its node_modules has the SDK
    //      via n8n-nodes-langchain).
    //   2. Standard resolution from this module (dev/test environments where
    //      the SDK is in this package's node_modules as a devDependency).
    const candidates: Array<{ source: string; req: NodeRequire }> = [];
    const mainFile = require.main?.filename;
    if (mainFile) candidates.push({ source: 'main', req: createRequire(mainFile) });
    candidates.push({ source: 'local', req: createRequire(__filename) });

    for (const { source, req } of candidates) {
        try {
            const serverIndex = req('@modelcontextprotocol/sdk/server/index.js');
            const sse = req('@modelcontextprotocol/sdk/server/sse.js');
            const streamable = req('@modelcontextprotocol/sdk/server/streamableHttp.js');
            const types = req('@modelcontextprotocol/sdk/types.js');
            const z2j = req('zod-to-json-schema');
            _sdk = {
                Server: serverIndex.Server,
                SSEServerTransport: sse.SSEServerTransport,
                StreamableHTTPServerTransport: streamable.StreamableHTTPServerTransport,
                ListToolsRequestSchema: types.ListToolsRequestSchema,
                CallToolRequestSchema: types.CallToolRequestSchema,
                // zod-to-json-schema exposes `zodToJsonSchema` as named + default.
                zodToJsonSchema: (z2j.zodToJsonSchema ?? z2j.default ?? z2j) as LoadedMcpSdk['zodToJsonSchema'],
            };
            return _sdk;
        } catch (err) {
            errors.push(`  ${source}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    throw new Error(
        `AutotaskMcpServer: failed to resolve @modelcontextprotocol/sdk from any source. ` +
        `n8n must be running with @modelcontextprotocol/sdk available (typically via n8n-nodes-langchain).\n${errors.join('\n')}`,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {} };

function convertSchemaToJsonSchema(schema: unknown, sdk: LoadedMcpSdk): Record<string, unknown> {
    if (!schema) return DEFAULT_INPUT_SCHEMA;
    // Already a JSON Schema-like object.
    if (typeof schema === 'object' && schema !== null && (schema as { type?: unknown }).type === 'object') {
        return schema as Record<string, unknown>;
    }
    try {
        const converted = sdk.zodToJsonSchema(schema as object, { name: undefined });
        // zod-to-json-schema may wrap with $ref/definitions when `name` is set; we passed undefined to get a flat object.
        if (converted && typeof converted === 'object') {
            // Strip $schema, definitions if present at the top — MCP wants a clean object schema.
            const { $schema: _s, definitions: _d, ...rest } = converted as Record<string, unknown>;
            return rest as Record<string, unknown>;
        }
    } catch {
        // Fall through to default
    }
    return DEFAULT_INPUT_SCHEMA;
}

function coerceInvokeResultToString(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function tryParseJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// AutotaskMcpServer
// ---------------------------------------------------------------------------

export class AutotaskMcpServer {
    private readonly _serverInfo: AutotaskMcpServerOptions['serverInfo'];
    private readonly _tools: Map<string, McpToolDescriptor>;
    private readonly _injectAutotaskCredentials: boolean;
    private readonly _httpRequest: AutotaskMcpServerOptions['httpRequest'];
    private readonly _sdk: LoadedMcpSdk;

    constructor(options: AutotaskMcpServerOptions) {
        this._serverInfo = options.serverInfo;
        this._injectAutotaskCredentials = options.injectAutotaskCredentials;
        this._httpRequest = options.httpRequest;
        this._sdk = loadMcpSdk();

        this._tools = new Map();
        for (const tool of options.tools) {
            const inputSchema = convertSchemaToJsonSchema(tool.schema, this._sdk);
            this._tools.set(tool.name, {
                name: tool.name,
                description: tool.description ?? '',
                inputSchema,
                invoke: async (args) => coerceInvokeResultToString(await tool.invoke(args)),
            });
        }
    }

    /**
     * Returns the registered tool names. Used by the webhook handler for diagnostics.
     */
    listToolNames(): string[] {
        return [...this._tools.keys()];
    }

    /**
     * Create a fresh MCP `Server` instance, register handlers, and return it.
     * We create a new Server per HTTP request so that transport lifecycle and
     * any per-session state stays isolated (the MCP SDK's Server is designed
     * around a single transport).
     */
    private createServer(): any {
        const { Server, ListToolsRequestSchema, CallToolRequestSchema } = this._sdk;
        const server = new Server(
            { name: this._serverInfo.name, version: this._serverInfo.version },
            { capabilities: { tools: {} } },
        );
        this.setupHandlers(server, ListToolsRequestSchema, CallToolRequestSchema);
        return server;
    }

    /**
     * Register `tools/list` and `tools/call` handlers on `server`.
     *
     * CRITICAL: capture instance state as locals BEFORE registering the
     * handlers. The SDK's handler dispatch may cross async boundaries (await,
     * setImmediate) and if we relied on `this` we would risk binding issues
     * — especially under per-request McpServer wrappers in tests.
     */
    private setupHandlers(server: any, ListToolsRequestSchema: any, CallToolRequestSchema: any): void {
        const tools = this._tools;
        const injectAutotaskCredentials = this._injectAutotaskCredentials;
        const httpRequest = this._httpRequest;

        server.setRequestHandler(ListToolsRequestSchema, async () => {
            const list = [...tools.values()].map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            }));
            return { tools: list };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
            const name: string | undefined = request?.params?.name;
            const args: Record<string, unknown> = (request?.params?.arguments ?? {}) as Record<string, unknown>;
            const tool = name ? tools.get(name) : undefined;

            if (!tool) {
                const err = wrapError(
                    'autotaskMcpTrigger',
                    name ?? 'unknown',
                    ERROR_TYPES.INVALID_OPERATION,
                    `Unknown tool '${name ?? '(missing)'}'. No tool with that name is registered.`,
                    `Use 'tools/list' to enumerate available tools.`,
                );
                return { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true };
            }

            const headers = requestHeaderStore.getStore() ?? {};
            let overrideCreds: Readonly<OverrideAutotaskCredentials> | undefined;

            if (injectAutotaskCredentials) {
                const parsed = parseAndValidateHeaders(headers);
                if (parsed.type === 'error') {
                    const err = wrapError(
                        'autotaskMcpTrigger',
                        name as string,
                        ERROR_TYPES.PERMISSION_DENIED,
                        `Per-user credential injection is enabled but the X-Autotask-* headers are invalid: ${parsed.message}`,
                        `Provide a complete and valid set of X-Autotask-* request headers (Username, Secret, IntegrationCode, Zone).`,
                    );
                    return { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true };
                }
                if (parsed.type === 'ok') {
                    overrideCreds = parsed.creds;
                    // Probe before injecting to fail fast on invalid creds.
                    // probeCredentials returns true on network errors (not cached),
                    // so transient outages do not lock users out.
                    let probeOk = true;
                    try {
                        probeOk = await probeCredentials(overrideCreds, httpRequest);
                    } catch {
                        // Defensive: treat unexpected throw as "allow through" — same as network errors.
                        probeOk = true;
                    }
                    if (!probeOk) {
                        const err = wrapError(
                            'autotaskMcpTrigger',
                            name as string,
                            ERROR_TYPES.PERMISSION_DENIED,
                            `Autotask rejected the injected credentials (401/403).`,
                            `Verify the X-Autotask-Username, X-Autotask-Secret, and X-Autotask-IntegrationCode header values are correct for the X-Autotask-Zone you provided.`,
                        );
                        return { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true };
                    }
                }
            }

            // Execute the tool, optionally inside the credential ALS context.
            let resultStr: string;
            try {
                if (overrideCreds) {
                    resultStr = await autotaskCredentialStore.run(
                        overrideCreds,
                        async () => tool.invoke(args),
                    );
                } else {
                    resultStr = await tool.invoke(args);
                }
            } catch (toolErr) {
                const err = wrapError(
                    'autotaskMcpTrigger',
                    name as string,
                    ERROR_TYPES.API_ERROR,
                    `Tool '${name}' threw during invocation: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`,
                    `Inspect the n8n execution logs for the underlying error.`,
                );
                return { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true };
            }

            // If the tool returned a PERMISSION_DENIED envelope (Autotask 401/403 during
            // a real call), evict the probe cache so the next request re-probes instead
            // of using a stale positive entry.
            if (overrideCreds) {
                const parsed = tryParseJson(resultStr) as { errorType?: string } | undefined;
                if (parsed && parsed.errorType === ERROR_TYPES.PERMISSION_DENIED) {
                    try {
                        invalidateProbeCache(probeCredentialIdentity(overrideCreds));
                    } catch {
                        // Defensive — invalidation is best-effort; never fail the tool call on it.
                    }
                }
            }

            return { content: [{ type: 'text', text: resultStr }] };
        });
    }

    /**
     * Connect a Streamable HTTP transport and dispatch the current request.
     * Webhook handler should call this for POST/DELETE on the main MCP path.
     */
    async handleStreamableHttpRequest(
        req: IncomingMessage,
        res: ServerResponse,
        parsedBody?: unknown,
    ): Promise<void> {
        const { StreamableHTTPServerTransport } = this._sdk;
        const transport = new StreamableHTTPServerTransport({
            // Stateless mode — n8n is fronted by an HTTP layer that has no
            // persistent connection to the MCP client between requests.
            sessionIdGenerator: undefined,
        });
        const server = this.createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
        // Clean up — close the transport so any allocated resources are released.
        try { await transport.close?.(); } catch { /* ignore */ }
        try { await server.close?.(); } catch { /* ignore */ }
    }

    /**
     * Open a long-lived SSE connection for the legacy SSE transport.
     * `messageEndpoint` is the URL clients should POST messages to (relative
     * or absolute as the deployment requires).
     *
     * Returns the underlying transport so the caller can plug in POST message
     * routing via `transport.handlePostMessage(req, res, body)`.
     */
    async openSseConnection(messageEndpoint: string, res: ServerResponse): Promise<any> {
        const { SSEServerTransport } = this._sdk;
        const transport = new SSEServerTransport(messageEndpoint, res);
        const server = this.createServer();
        await server.connect(transport);
        return transport;
    }

    /**
     * Convenience: route an incoming POST to an already-open SSE transport.
     */
    async handleSsePostMessage(transport: any, req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
        await transport.handlePostMessage(req, res, body);
    }
}
