/**
 * AutotaskMcpTrigger — n8n MCP Trigger fork that optionally injects per-user
 * Autotask credentials extracted from incoming X-Autotask-* HTTP headers into
 * connected AutotaskAiTools tool calls.
 *
 * Source reference (architectural model):
 *   packages/@n8n/nodes-langchain/nodes/mcp/McpTrigger/McpTrigger.node.ts
 *
 * Webhook layout:
 *   v1 / v1.1 (SSE — deprecated)
 *     GET  /{path}/sse        → open SSE connection (webhook name 'setup')
 *     POST /{path}/messages   → client → server message (webhook name 'default')
 *   v2 (Streamable HTTP — preferred)
 *     POST   /{path}          → all client → server messages
 *     DELETE /{path}          → session cleanup
 *     GET    /{path}          → reserved (SSE setup path collapses into base path)
 *
 * Credential injection (per-request):
 *   The webhook handler normalises incoming HTTP headers and — when injection
 *   is enabled — runs the SDK's transport.handleRequest(...) inside an
 *   AsyncLocalStorage context populated from those headers. The connected
 *   AutotaskAiTools node reads the override credentials from the same ALS
 *   inside its tool's func() and routes Autotask API calls through them.
 *
 *   Important: ALS does NOT cross process boundaries. Running n8n in queue
 *   mode (EXECUTIONS_MODE=queue) means the webhook process and the worker
 *   process are different — the ALS context will be empty in the worker.
 *   We warn at activation time when this combination is detected.
 */

import type {
    INodeType,
    INodeTypeDescription,
    IWebhookFunctions,
    IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import {
    requestHeaderStore,
    probeCredentials,
} from './helpers/credential-store';
import { normaliseIncomingHeaders, parseAndValidateHeaders } from './helpers/credential-proxy';
import { AutotaskMcpServer, type N8nLikeTool } from './mcp-trigger/McpServer';

const MCP_SSE_SETUP_PATH = 'sse';
const MCP_SSE_MESSAGES_PATH = 'messages';

// ---------------------------------------------------------------------------
// Module-scope SSE session map.
//
// SSE is a long-lived connection. When the client posts a message we need to
// route it back to the open transport for the same session. The transport's
// own session ID is used as the map key.
//
// Streamable HTTP (v2+) does NOT need this — each request is stateless from
// the n8n webhook perspective (the MCP SDK transport handles its own
// streaming response on the same request).
// ---------------------------------------------------------------------------
const MAX_SSE_SESSIONS = 256;
const sseSessions = new Map<string, { transport: any; server: any }>();

async function evictOldestSseSession(): Promise<void> {
    const entry = sseSessions.entries().next().value as [string, { transport: any; server: any }] | undefined;
    if (!entry) return;
    const [oldestId, oldest] = entry;
    sseSessions.delete(oldestId);
    try { await oldest.transport?.close?.(); } catch { /* ignore */ }
    try { await oldest.server?.close?.(); } catch { /* ignore */ }
}

export class AutotaskMcpTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Autotask MCP Trigger',
        name: 'autotaskMcpTrigger',
        icon: 'file:autotask.svg',
        group: ['trigger'] as const,
        version: [1, 1.1, 2],
        description: 'Autotask MCP Trigger with optional per-user credential injection from X-Autotask-* headers',
        subtitle: '={{$parameter["path"] ? "/" + $parameter["path"] : "MCP"}}',
        activationMessage:
            'You can now connect your MCP Clients to the URL, using SSE or Streamable HTTP transports.',
        defaults: {
            name: 'Autotask MCP Trigger',
        },
        inputs: [
            {
                type: NodeConnectionTypes.AiTool,
                displayName: 'Tools',
            },
        ],
        outputs: [],
        credentials: [
            {
                name: 'autotaskApi',
                required: false,
                displayOptions: {
                    show: {
                        authentication: ['autotaskCredentials'],
                    },
                },
            },
        ],
        properties: [
            {
                displayName: 'Authentication',
                name: 'authentication',
                type: 'options',
                options: [
                    { name: 'None', value: 'none' },
                    { name: 'Autotask Credentials (Per-User)', value: 'autotaskCredentials' },
                ],
                default: 'none',
                description: 'The way to authenticate inbound MCP requests',
            },
            {
                displayName: 'Path',
                name: 'path',
                type: 'string',
                default: '',
                placeholder: 'autotask-mcp',
                required: true,
                description: 'The base path for this Autotask MCP server',
            },
            {
                displayName: 'Inject Autotask Credentials',
                name: 'injectAutotaskCredentials',
                type: 'boolean',
                default: false,
                description: 'Whether to extract Autotask credentials from incoming X-Autotask-* HTTP headers and inject them into tool calls. Requires the connected AutotaskAiTools node to have "Accept Injected Credentials" enabled. NOT supported in queue mode.',
                noDataExpression: true,
            },
        ],
        webhooks: [
            {
                name: 'setup',
                httpMethod: 'GET',
                responseMode: 'onReceived',
                isFullPath: true,
                path: `={{$parameter["path"]}}{{parseFloat($nodeVersion)<2 ? '/${MCP_SSE_SETUP_PATH}' : ''}}`,
            },
            {
                name: 'default',
                httpMethod: 'POST',
                responseMode: 'onReceived',
                isFullPath: true,
                path: `={{$parameter["path"]}}{{parseFloat($nodeVersion)<2 ? '/${MCP_SSE_MESSAGES_PATH}' : ''}}`,
            },
            {
                name: 'default',
                httpMethod: 'DELETE',
                responseMode: 'onReceived',
                isFullPath: true,
                path: '={{$parameter["path"]}}',
            },
        ],
    };

    async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
        const req = this.getRequestObject();
        const res = this.getResponseObject();
        const webhookName = this.getWebhookName();
        const nodeVersion = this.getNode().typeVersion ?? 1;
        const isSseTransport = nodeVersion < 2;

        const injectAutotaskCredentials = this.getNodeParameter(
            'injectAutotaskCredentials',
            false,
        ) as boolean;

        const authentication = this.getNodeParameter('authentication', 'none') as string;

        // When per-user auth is active, injection must also be active — otherwise the
        // credentials used to pass the auth gate (X-Autotask-* headers) are validated
        // but then ignored, and tool calls run under the workflow-owner credential.
        // That is a privilege-escalation path: an external caller with any valid Autotask
        // credential gains access to a potentially higher-privileged account.
        const effectiveInjectCredentials = injectAutotaskCredentials || authentication === 'autotaskCredentials';

        // Node ID is stable per workflow node — used to scope SSE sessions so two
        // trigger instances with different paths cannot share session entries.
        const nodeId = this.getNode().id;

        // Normalise headers once — needed for auth gate which must run before tool loading.
        const normalisedHeaders = normaliseIncomingHeaders(req.headers);

        // Build httpRequestFn early — needed by the auth probe below.
        const helpers = this.helpers;
        const httpRequestFn = async (opts: {
            method: string;
            url: string;
            headers: Record<string, string>;
        }) => {
            return helpers.httpRequest({
                method: opts.method as 'GET',
                url: opts.url,
                headers: opts.headers,
            });
        };

        // SSE POST short-circuit — route directly to existing transport without
        // loading tools or building an McpServer. The McpServer for this session was
        // already constructed on the SSE setup GET; tool loading here would needlessly
        // trigger supplyData() API calls on every tool invocation.
        if (isSseTransport && webhookName === 'default' && req.method === 'POST') {
            const sessionId = (req.query?.sessionId as string | undefined) ?? '';
            const sessionKey = sessionId ? `${nodeId}:${sessionId}` : '';
            const session = sessionKey ? sseSessions.get(sessionKey) : undefined;
            if (!session) {
                res.status(404).json({ error: 'No active SSE session for sessionId' });
                return { noWebhookResponse: true };
            }
            // Enforce header-level auth on SSE POST when configured, so unauthenticated
            // clients cannot reach tools/list or initialize on an open session.
            // Full credential probe happens inside McpServer.setupHandlers per tools/call.
            if (authentication === 'autotaskCredentials') {
                const parsed = parseAndValidateHeaders(normalisedHeaders);
                if (parsed.type === 'none') {
                    res.status(401).json({ error: 'Authentication required: X-Autotask-Username, X-Autotask-Secret, X-Autotask-IntegrationCode, and X-Autotask-Zone headers are required.' });
                    return { noWebhookResponse: true };
                }
                if (parsed.type === 'error') {
                    res.status(401).json({ error: `Authentication failed: ${parsed.message}` });
                    return { noWebhookResponse: true };
                }
            }
            await requestHeaderStore.run(normalisedHeaders, async () => {
                await session.transport.handlePostMessage(req, res, (req as { body?: unknown }).body);
            });
            return { noWebhookResponse: true };
        }

        // SSE DELETE short-circuit — close + delete session without loading tools.
        if (isSseTransport && req.method === 'DELETE') {
            const sessionId = (req.query?.sessionId as string | undefined) ?? '';
            const sessionKey = sessionId ? `${nodeId}:${sessionId}` : '';
            if (sessionKey && sseSessions.has(sessionKey)) {
                const { transport, server } = sseSessions.get(sessionKey)!;
                try { await transport.close?.(); } catch { /* ignore */ }
                try { await server.close?.(); } catch { /* ignore */ }
                sseSessions.delete(sessionKey);
            }
            res.status(204).end();
            return { noWebhookResponse: true };
        }

        // Queue-mode check. In queue mode ALS cannot cross process boundaries so
        // injected credentials are silently unavailable in workers.
        // - With authentication='autotaskCredentials': reject hard (503) — the caller's
        //   credentials would pass the auth gate but tool calls would run under the
        //   workflow-owner credential, breaking per-caller isolation.
        // - With injection-only (no auth gate): warn only — tools fall back to
        //   workflow-owner creds, which is a usability issue but not a security regression.
        if (process.env.EXECUTIONS_MODE === 'queue') {
            if (authentication === 'autotaskCredentials') {
                res.status(503).json({
                    error: 'Per-user Autotask credential authentication is not supported in queue mode. ' +
                        'AsyncLocalStorage cannot cross process boundaries — injected credentials would ' +
                        'be unavailable in workers, causing tool calls to run under the workflow-owner credential. ' +
                        'Switch n8n to regular (non-queue) mode or disable per-user authentication on this trigger.',
                });
                return { noWebhookResponse: true };
            }
            if (effectiveInjectCredentials) {
                console.warn(
                    '[AutotaskMcpTrigger] "Inject Autotask Credentials" is enabled but n8n is running in queue mode. ' +
                    'AsyncLocalStorage cannot cross process boundaries — injection will not work in workers.',
                );
            }
        }

        // Enforce webhook-level authentication BEFORE loading connected tools — only
        // for Streamable HTTP. For SSE, the auth gate would reject the GET setup
        // when MCP clients send X-Autotask-* headers only on POST /messages tool
        // calls (not on the SSE setup GET). The McpServer already validates
        // credentials per tools/call via requestHeaderStore + ALS, so the
        // webhook-level gate is only meaningful for Streamable HTTP where each
        // POST is a complete session.
        if (!isSseTransport && authentication === 'autotaskCredentials') {
            const parsed = parseAndValidateHeaders(normalisedHeaders);
            if (parsed.type === 'none') {
                res.status(401).json({ error: 'Authentication required: X-Autotask-Username, X-Autotask-Secret, X-Autotask-IntegrationCode, and X-Autotask-Zone headers are required.' });
                return { noWebhookResponse: true };
            }
            if (parsed.type === 'error') {
                res.status(401).json({ error: `Authentication failed: ${parsed.message}` });
                return { noWebhookResponse: true };
            }
            // Probe the credentials — returns true on network errors (fail-open).
            let probeOk = true;
            try {
                probeOk = await probeCredentials(parsed.creds, httpRequestFn);
            } catch {
                probeOk = true;
            }
            if (!probeOk) {
                res.status(401).json({ error: 'Authentication failed: Autotask rejected the provided credentials (401/403). Verify X-Autotask-* header values.' });
                return { noWebhookResponse: true };
            }
        }

        // Fetch the connected AI tools. supplyData() runs on each AutotaskAiTools
        // node and returns its DynamicStructuredTool. This happens AFTER the auth gate
        // so unauthenticated callers do not trigger API/metadata work.
        let tools: N8nLikeTool[] = [];
        try {
            const supplied = await this.getInputConnectionData(NodeConnectionTypes.AiTool, 0);
            if (Array.isArray(supplied)) {
                tools = supplied as N8nLikeTool[];
            } else if (supplied && typeof supplied === 'object') {
                tools = [supplied as N8nLikeTool];
            }
        } catch (err) {
            console.warn(
                '[AutotaskMcpTrigger] Failed to fetch AI tools from input connection: ' +
                (err instanceof Error ? err.message : String(err)),
            );
        }

        // If injection is enabled and the client actually sent a username header,
        // verify each connected AutotaskAiTools node has acceptInjectedCredentials
        // enabled. AutotaskAiTools nodes connect to the trigger's AiTool INPUT, making
        // them parent nodes — getParentNodes() is the correct direction, not getChildNodes().
        if (
            effectiveInjectCredentials &&
            typeof normalisedHeaders['x-autotask-username'] === 'string'
        ) {
            try {
                const parents = this.getParentNodes(this.getNode().name, {
                    includeNodeParameters: true,
                    connectionType: NodeConnectionTypes.AiTool,
                }) as Array<{ name?: string; type?: string; parameters?: Record<string, unknown> }>;
                const autotaskAiTools = parents.filter((c) => c.type === 'n8n-nodes-autotask.autotaskAiTools');
                const rejecting = autotaskAiTools.filter(
                    (c) => !(c.parameters && c.parameters['acceptInjectedCredentials'] === true),
                );
                if (rejecting.length > 0) {
                    const names = rejecting.map((n) => n.name ?? '(unnamed)').join(', ');
                    if (authentication === 'autotaskCredentials') {
                        // Hard reject: caller passed the auth gate with their Autotask credentials,
                        // but these tool nodes would silently fall back to the workflow-owner credential.
                        // That is a privilege-escalation path — fail closed.
                        res.status(403).json({
                            error: 'Workflow misconfiguration: the following connected AutotaskAiTools node(s) do not have ' +
                                '"Accept Injected Credentials" enabled. When per-user authentication is active, all connected ' +
                                'tool nodes must opt in — otherwise callers run tools under the workflow-owner credential. ' +
                                `Enable "Accept Injected Credentials" on: ${names}`,
                        });
                        return { noWebhookResponse: true };
                    }
                    // Injection-only mode (no auth gate): warn. Caller is already using the workflow-owner
                    // credential context; the fall-through is a usability issue, not a security regression.
                    console.warn(
                        `[AutotaskMcpTrigger] X-Autotask-* headers received but the following connected AutotaskAiTools node(s) ` +
                        `do not have "Accept Injected Credentials" enabled — those tools will use the workflow-owner credentials, ` +
                        `not the caller's injected credentials. Enable "Accept Injected Credentials" on those nodes if injection ` +
                        `should be enforced end-to-end: ${names}`,
                    );
                }
            } catch {
                // getParentNodes may be unavailable in some n8n contexts (older versions).
                // This check is advisory only — do not fail the request.
            }
        }

        let mcpServer: AutotaskMcpServer;
        try {
            mcpServer = new AutotaskMcpServer({
                serverInfo: { name: 'autotask-mcp-trigger', version: '1.0.0' },
                tools,
                injectAutotaskCredentials: effectiveInjectCredentials,
                httpRequest: httpRequestFn,
            });
        } catch (err) {
            console.error(
                '[AutotaskMcpTrigger] Failed to initialise MCP server: ' +
                (err instanceof Error ? err.message : String(err)),
            );
            res.status(500).json({
                error: 'AutotaskMcpTrigger: MCP SDK unavailable. n8n must be running with @modelcontextprotocol/sdk available.',
            });
            return { noWebhookResponse: true };
        }

        // ---------------------------------------------------------------------
        // Dispatch by webhook + version.
        // ---------------------------------------------------------------------

        try {
            if (isSseTransport) {
                if (webhookName === 'setup' && req.method === 'GET') {
                    // SSE setup — open a long-lived connection.
                    // Derive messageEndpoint from the actual incoming request path so that
                    // any n8n webhook prefix or reverse-proxy prefix is preserved in the
                    // `event: endpoint` value sent to clients. Building it from the raw
                    // node parameter loses those prefixes and clients would POST to the wrong URL.
                    const incomingPath = (req.url ?? '').split('?')[0];
                    const messageEndpoint = incomingPath.endsWith(`/${MCP_SSE_SETUP_PATH}`)
                        ? incomingPath.slice(0, -MCP_SSE_SETUP_PATH.length) + MCP_SSE_MESSAGES_PATH
                        : `/${(this.getNodeParameter('path', '') as string).replace(/^\/+/, '').replace(/\/+$/, '')}/${MCP_SSE_MESSAGES_PATH}`;
                    await requestHeaderStore.run(normalisedHeaders, async () => {
                        const { transport, server } = await mcpServer.openSseConnection(messageEndpoint, res);
                        const sessionId = transport.sessionId as string | undefined;
                        if (sessionId) {
                            const sessionKey = `${nodeId}:${sessionId}`;
                            if (sseSessions.size >= MAX_SSE_SESSIONS) {
                                await evictOldestSseSession();
                            }
                            sseSessions.set(sessionKey, { transport, server });
                            const cleanup = async () => {
                                sseSessions.delete(sessionKey);
                                try { await server.close?.(); } catch { /* ignore */ }
                            };
                            transport.onclose = cleanup;
                            res.on('close', cleanup);
                        }
                    });
                    return { noWebhookResponse: true };
                }

                res.status(405).json({ error: `Method ${req.method} not allowed for SSE transport` });
                return { noWebhookResponse: true };
            }

            // ---- Streamable HTTP (v2+) ----
            await requestHeaderStore.run(normalisedHeaders, async () => {
                await mcpServer.handleStreamableHttpRequest(req, res, (req as { body?: unknown }).body);
            });
            return { noWebhookResponse: true };
        } catch (err) {
            console.error(
                '[AutotaskMcpTrigger] webhook handler error: ' +
                (err instanceof Error ? err.stack ?? err.message : String(err)),
            );
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'AutotaskMcpTrigger: internal error',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
            return { noWebhookResponse: true };
        }
    }
}
