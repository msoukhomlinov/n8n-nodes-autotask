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
} from './helpers/credential-store';
import { normaliseIncomingHeaders } from './helpers/credential-proxy';
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
const sseSessions = new Map<string, { transport: any; server: any }>();

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

        // Queue-mode incompatibility check (runtime warning, not a hard fail —
        // operators can still use the node without injection).
        if (injectAutotaskCredentials && process.env.EXECUTIONS_MODE === 'queue') {
            console.warn(
                '[AutotaskMcpTrigger] "Inject Autotask Credentials" is enabled but n8n is running in queue mode. ' +
                'AsyncLocalStorage cannot cross process boundaries — injection will not work in workers.',
            );
        }

        // Normalise headers once, then propagate via ALS.
        const normalisedHeaders = normaliseIncomingHeaders(req.headers);

        // Fetch the connected AI tools. supplyData() runs on each AutotaskAiTools
        // node and returns its DynamicStructuredTool. We treat the result as an
        // array of objects with name/description/schema/invoke (the n8n public
        // shape of supplied tools).
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
        // enabled. We can only inspect node parameters via getChildNodes(); the
        // tools array itself does not expose the source node parameters.
        if (
            injectAutotaskCredentials &&
            typeof normalisedHeaders['x-autotask-username'] === 'string'
        ) {
            try {
                const children = this.getChildNodes(this.getNode().name, {
                    includeNodeParameters: true,
                }) as Array<{ name?: string; type?: string; parameters?: Record<string, unknown> }>;
                const autotaskAiTools = children.filter((c) => c.type === 'n8n-nodes-autotask.autotaskAiTools');
                const rejecting = autotaskAiTools.filter(
                    (c) => !(c.parameters && c.parameters['acceptInjectedCredentials'] === true),
                );
                if (rejecting.length > 0) {
                    console.warn(
                        `[AutotaskMcpTrigger] X-Autotask-* headers received but the following connected AutotaskAiTools node(s) ` +
                        `do not have "Accept Injected Credentials" enabled — those tools will continue using the workflow-owner credentials: ` +
                        `${rejecting.map((n) => n.name ?? '(unnamed)').join(', ')}`,
                    );
                }
            } catch {
                // getChildNodes may be unavailable in some n8n contexts (older versions).
                // This check is advisory only — do not fail the request.
            }
        }

        // Build the MCP server. We use a per-request wrapper around helpers.httpRequest
        // for the credential probe so the probe runs inside n8n's normal HTTP stack
        // (proxy support, TLS config, etc.).
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

        let mcpServer: AutotaskMcpServer;
        try {
            mcpServer = new AutotaskMcpServer({
                serverInfo: { name: 'autotask-mcp-trigger', version: '1.0.0' },
                tools,
                injectAutotaskCredentials,
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
                    const basePath = this.getNodeParameter('path', '') as string;
                    const messageEndpoint = `/${basePath.replace(/^\/+/, '').replace(/\/+$/, '')}/${MCP_SSE_MESSAGES_PATH}`;
                    await requestHeaderStore.run(normalisedHeaders, async () => {
                        const { transport, server } = await mcpServer.openSseConnection(messageEndpoint, res);
                        const sessionId = transport.sessionId as string | undefined;
                        if (sessionId) {
                            sseSessions.set(sessionId, { transport, server });
                            const cleanup = async () => {
                                sseSessions.delete(sessionId);
                                try { await server.close?.(); } catch { /* ignore */ }
                            };
                            transport.onclose = cleanup;
                            res.on('close', cleanup);
                        }
                    });
                    return { noWebhookResponse: true };
                }

                if (webhookName === 'default' && req.method === 'POST') {
                    // SSE message — route to the existing transport.
                    const sessionId = (req.query?.sessionId as string | undefined) ?? '';
                    const session = sessionId ? sseSessions.get(sessionId) : undefined;
                    if (!session) {
                        res.status(404).json({ error: 'No active SSE session for sessionId' });
                        return { noWebhookResponse: true };
                    }
                    await requestHeaderStore.run(normalisedHeaders, async () => {
                        await mcpServer.handleSsePostMessage(session.transport, req, res, (req as { body?: unknown }).body);
                    });
                    return { noWebhookResponse: true };
                }

                if (req.method === 'DELETE') {
                    const sessionId = (req.query?.sessionId as string | undefined) ?? '';
                    if (sessionId && sseSessions.has(sessionId)) {
                        const { transport, server } = sseSessions.get(sessionId)!;
                        try { await transport.close?.(); } catch { /* ignore */ }
                        try { await server.close?.(); } catch { /* ignore */ }
                        sseSessions.delete(sessionId);
                    }
                    res.status(204).end();
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
