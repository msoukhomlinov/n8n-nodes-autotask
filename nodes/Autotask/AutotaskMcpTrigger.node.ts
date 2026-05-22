/**
 * AutotaskMcpTrigger — Spike stub (Task 1: Fork Feasibility)
 *
 * This is a minimal TypeScript stub that proves the fork architecture compiles
 * inside the n8n-nodes-autotask package. It does NOT yet implement per-user
 * credential injection (that comes in subsequent tasks).
 *
 * Source reference: packages/@n8n/nodes-langchain/nodes/mcp/McpTrigger/McpTrigger.node.ts
 * Fetched from n8n-io/n8n main branch (n8n-workflow@2.21.1).
 *
 * MANUAL VERIFICATION REQUIRED before this stub is production-ready:
 *   Step 5:   Test that tools/list returns the correct tool list via a live MCP endpoint.
 *   Step 5b:  Verify ALS context propagates through the webhook call chain (smoke test
 *             with AsyncLocalStorage.getStore() inside the tool executor).
 */

import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

const MCP_SSE_SETUP_PATH = 'sse';
const MCP_SSE_MESSAGES_PATH = 'messages';

export class AutotaskMcpTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autotask MCP Trigger',
		name: 'autotaskMcpTrigger',
		icon: 'file:autotask.svg',
		group: ['trigger'] as const,
		version: [1, 1.1, 2],
		description: 'Autotask MCP Trigger with per-user credential injection (spike stub)',
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

	/**
	 * Stub webhook handler.
	 *
	 * TODO (subsequent tasks): Replace this with full McpServer delegation + ALS injection.
	 *
	 * The production implementation will:
	 *   1. Extract per-request Autotask credentials from the HTTP Authorization header (or
	 *      query param) and validate them.
	 *   2. Inject those credentials into an AsyncLocalStorage store so that downstream
	 *      EntityValueHelper / CacheService calls use the caller's credential identity rather
	 *      than the workflow-owner's stored credential.
	 *   3. Delegate to McpServer (imported at runtime via require to avoid module-resolution
	 *      issues) for the actual SSE / Streamable HTTP transport handling.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const resp = this.getResponseObject();
		resp.status(501).json({
			error: 'AutotaskMcpTrigger spike stub — not yet implemented',
			message: 'Per-user credential injection will be implemented in subsequent tasks.',
		});
		return { noWebhookResponse: true };
	}
}
