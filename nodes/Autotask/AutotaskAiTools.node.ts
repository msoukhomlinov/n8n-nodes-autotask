import { NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	ICredentialDataDecryptedObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	INodeExecutionData,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { RESOURCE_OPERATIONS_MAP, getResourceOperations } from './constants/resource-operations';
import { describeResource, type FieldMeta } from './helpers/aiHelper';
import {
	executeAiTool,
	type ToolExecutorParams,
	N8N_METADATA_FIELDS,
	N8N_METADATA_PREFIXES,
} from './ai-tools/tool-executor';
import {
	buildUnifiedDescriptionTemplate,
	injectDescriptionReferenceUtc,
} from './ai-tools/description-builders';
import {
	SUPPORTED_TOOL_OPERATIONS,
	getOperationMetadata,
	isWriteOperation,
} from './ai-tools/operation-metadata';
import { RuntimeDynamicStructuredTool, runtimeZod, getLazyLogWrapper } from './ai-tools/runtime';
import { getRuntimeSchemaBuilders } from './ai-tools/schema-generator';
import { isNodeResourceImpersonationSupported } from './helpers/impersonation';
import { wrapError, ERROR_TYPES } from './ai-tools/error-formatter';
import {
	validateOperationContract,
	type OperationContractViolation,
} from './ai-tools/operation-contracts';
import { computeMetadataRevision } from './helpers/cache/init';
import { hashCachePayload } from './helpers/cache/service';
import {
	AI_TOOL_DEBUG_VERBOSE,
	redactForVerbose,
	safeSchemaKeys,
	traceError,
	traceExecutor,
	traceToolBuild,
} from './ai-tools/debug-trace';

const EXCLUDED_RESOURCES = ['aiHelper', 'apiThreshold'];
const TOOL_BUILD_CACHE_TTL_MS = 90_000;
const METADATA_CACHE_TTL_MS = 90_000;
const MAX_CACHE_ENTRIES = 250;

interface MetadataCacheEntry {
	readFields: FieldMeta[];
	writeFields: FieldMeta[];
	metadataHash: string;
	expiresAt: number;
}

interface ArtifactCacheEntry {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	schema: any;
	descriptionTemplate: string;
	allAllowedOps: string[];
	expiresAt: number;
}

/** Minimal interface for calling safeParse on a Zod schema without importing zod types. */
interface ZodSafeParseable {
	safeParse(input: unknown):
		| { success: true; data: Record<string, unknown> }
		| { success: false; error: { message: string } };
}

const metadataCache = new Map<string, MetadataCacheEntry>();
const artifactCache = new Map<string, ArtifactCacheEntry>();

function getOpsSignature(operations: string[]): string {
	return [...operations].sort().join(',');
}

function getMetadataCacheKey(
	credentialIdentity: string,
	resource: string,
	needsReadFields: boolean,
	needsWriteFields: boolean,
): string {
	return `${credentialIdentity}|${resource}|read:${needsReadFields ? '1' : '0'}|write:${needsWriteFields ? '1' : '0'}`;
}

function getArtifactCacheKey(
	credentialIdentity: string,
	resource: string,
	effectiveOps: string[],
	allowWriteOperations: boolean,
	supportsImpersonation: boolean,
	metadataHash: string,
): string {
	return `${credentialIdentity}|${resource}|ops:${getOpsSignature(effectiveOps)}|allowWrite:${allowWriteOperations ? '1' : '0'}|imp:${supportsImpersonation ? '1' : '0'}|meta:${metadataHash}`;
}

function getCachedEntry<T extends { expiresAt: number }>(cache: Map<string, T>, key: string): T | undefined {
	const hit = cache.get(key);
	if (!hit) return undefined;
	if (hit.expiresAt <= Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return hit;
}

function setCachedEntry<T extends { expiresAt: number }>(
	cache: Map<string, T>,
	key: string,
	value: T,
	maxEntries: number,
): void {
	if (cache.size >= maxEntries) {
		const firstKey = cache.keys().next().value as string | undefined;
		if (firstKey) cache.delete(firstKey);
	}
	cache.set(key, value);
}

function getReferenceUtcNow(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function getMetadataNeeds(operations: string[]): { needsReadFields: boolean; needsWriteFields: boolean } {
	const needsReadFields = operations.some((op) =>
		[
			'get',
			'getMany',
			'getPosted',
			'getUnposted',
			'count',
			'whoAmI',
			'searchByDomain',
			'getByResource',
			'getByYear',
		].includes(op),
	);
	const needsWriteFields = operations.some((op) => ['create', 'createIfNotExists', 'update'].includes(op));
	return { needsReadFields, needsWriteFields };
}

async function resolveCredentialIdentity(
	context: ISupplyDataFunctions | IExecuteFunctions,
): Promise<string | null> {
	try {
		const credentials = (await context.getCredentials(
			'autotaskApi',
		)) as ICredentialDataDecryptedObject;
		return hashCachePayload({
			username: credentials.Username,
			integrationCode: credentials.APIIntegrationcode,
			zone: credentials.zone,
			customZoneUrl: credentials.customZoneUrl,
		}).slice(0, 16);
	} catch {
		return null;
	}
}

async function resolveMetadataForTool(
	context: ISupplyDataFunctions | IExecuteFunctions,
	resource: string,
	operations: string[],
	credentialIdentity: string | null,
	itemIndex?: number,
): Promise<{
	readFields: FieldMeta[];
	writeFields: FieldMeta[];
	metadataHash: string;
	cacheHit: boolean;
	durationMs: number;
}> {
	const { needsReadFields, needsWriteFields } = getMetadataNeeds(operations);

	if (credentialIdentity !== null) {
		const cacheKey = getMetadataCacheKey(credentialIdentity, resource, needsReadFields, needsWriteFields);
		const cached = getCachedEntry(metadataCache, cacheKey);
		if (cached) {
			return {
				readFields: cached.readFields,
				writeFields: cached.writeFields,
				metadataHash: cached.metadataHash,
				cacheHit: true,
				durationMs: 0,
			};
		}
	}

	const metadataStart = Date.now();
	const [readDescribe, writeDescribe] = await Promise.all([
		needsReadFields
			? describeResource(context as unknown as ILoadOptionsFunctions, resource, 'read')
			: Promise.resolve(undefined),
		needsWriteFields
			? describeResource(context as unknown as ILoadOptionsFunctions, resource, 'write')
			: Promise.resolve(undefined),
	]);
	const durationMs = Date.now() - metadataStart;
	const readFields = readDescribe?.fields ?? [];
	const writeFields = writeDescribe?.fields ?? [];
	const metadataHash = computeMetadataRevision(
		readFields as unknown as Array<Record<string, unknown>>,
		writeFields as unknown as Array<Record<string, unknown>>,
	);

	if (credentialIdentity !== null) {
		setCachedEntry(
			metadataCache,
			getMetadataCacheKey(credentialIdentity, resource, needsReadFields, needsWriteFields),
			{
				readFields,
				writeFields,
				metadataHash,
				expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
			},
			MAX_CACHE_ENTRIES,
		);
	}

	traceToolBuild({
		phase: 'metadata-fetched',
		resource,
		itemIndex,
		durationMs,
		summary: {
			readMetadataFetched: needsReadFields,
			writeMetadataFetched: needsWriteFields,
			readFieldCount: readFields.length,
			writeFieldCount: writeFields.length,
			cacheHit: false,
			metadataHash,
		},
	});
	return {
		readFields,
		writeFields,
		metadataHash,
		cacheHit: false,
		durationMs,
	};
}

function formatResourceName(value: string): string {
	return (
		value.charAt(0).toUpperCase() +
		value
			.slice(1)
			.replace(/([A-Z])/g, ' $1')
			.trim()
	);
}

/**
 * Pre-parse normalisation for Agent V3 `execute()` path.
 *
 * 1. Strips n8n framework metadata (`sessionId`, `operation`, `Prompt__*`, etc.)
 *    so it never reaches `safeParse` — prevents false "unknown key" noise in
 *    error messages, and mirrors what `supplyData() → func()` does via Zod
 *    `.strip()` semantics.
 * 2. Converts `null` → `undefined` for every remaining field. LLMs (especially
 *    weaker ones) frequently emit JSON `null` for "not applicable" fields
 *    (e.g. `{ "id": null, "ticketNumber": "T20240615.0674" }`). Our schema
 *    uses `.optional()` on most fields — which accepts `undefined` but REJECTS
 *    `null`. Normalising here lets the schema treat "not provided" uniformly
 *    regardless of how the LLM spelled it. Fields declared `.nullish()` in
 *    schema-generator.ts still accept null natively; normalising `null → undefined`
 *    is additionally defensive for any field that slips back to `.optional()`.
 */
function stripAndNormaliseItemJson(itemJson: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(itemJson)) {
		if (N8N_METADATA_FIELDS.has(key)) continue;
		if (N8N_METADATA_PREFIXES.some((p) => key.startsWith(p))) continue;
		out[key] = value === null ? undefined : value;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Node class
// ---------------------------------------------------------------------------

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class AutotaskAiTools implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autotask AI Tools',
		name: 'autotaskAiTools',
		icon: 'file:autotask.svg',
		group: ['output'],
		version: 1,
		description: 'Expose Autotask operations as individual AI tools for the AI Agent',
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://github.com/msoukhomlinov/n8n-nodes-autotask',
					},
					{
						url: 'https://ww6.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm',
					},
				],
			},
		},
		defaults: {
			name: 'Autotask AI Tools',
		},
		inputs: [],
		outputs: [{ type: 'ai_tool', displayName: 'Tools' }],
		credentials: [{ name: 'autotaskApi', required: true }],
		properties: [
			{
				displayName: 'Resource Name or ID',
				name: 'resource',
				type: 'options',
				required: true,
				noDataExpression: true,
				typeOptions: { loadOptionsMethod: 'getToolResources' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Operations Names or IDs',
				name: 'operations',
				type: 'multiOptions',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getToolResourceOperations',
					loadOptionsDependsOn: ['resource', 'allowWriteOperations'],
				},
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Allow Write Operations',
				name: 'allowWriteOperations',
				type: 'boolean',
				default: false,
				description:
					'Whether to enable mutating tools (create, createIfNotExists, moveToCompany, moveConfigurationItem, transferOwnership, update, delete). Disabled = read-only.',
			},
		],
	};

	methods = {
		loadOptions: {
			getToolResources,
			getToolResourceOperations,
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const { buildUnifiedSchema } = getRuntimeSchemaBuilders(runtimeZod);

		const resource = this.getNodeParameter('resource', itemIndex) as string;
		const operations = this.getNodeParameter('operations', itemIndex) as string[];
		const allowWriteOperations = this.getNodeParameter(
			'allowWriteOperations',
			itemIndex,
			false,
		) as boolean;

		if (!resource) {
			throw new NodeOperationError(this.getNode(), 'Resource is required');
		}
		if (!operations?.length) {
			throw new NodeOperationError(this.getNode(), 'At least one operation must be selected');
		}

		const unsupportedOperations = operations.filter(
			(operation) => !SUPPORTED_TOOL_OPERATIONS.includes(operation),
		);
		if (unsupportedOperations.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`Unsupported operation(s) for AI tools: ${unsupportedOperations.join(', ')}. ` +
					`Supported operations are: ${SUPPORTED_TOOL_OPERATIONS.join(', ')}.`,
			);
		}

		const effectiveOps = operations.filter(
			(op) => !isWriteOperation(op) || allowWriteOperations,
		);
		if (effectiveOps.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'No permitted operations. Enable "Allow Write Operations" if write operations are needed.',
			);
		}

		const supplyStart = Date.now();
		const resourceLabel = formatResourceName(resource);
		const referenceUtc = getReferenceUtcNow();
		const supportsImpersonation = isNodeResourceImpersonationSupported(resource);
		const credentialIdentity = await resolveCredentialIdentity(this);
		// Trace tool-construction decisions to understand what the AI can see.
		traceToolBuild({
			phase: 'supplyData-start',
			resource,
			itemIndex,
			summary: {
				selectedResource: resource,
				configuredOperations: operations,
				effectiveOperations: effectiveOps,
				writeOpsAllowed: allowWriteOperations,
				supportsImpersonation,
				credentialIdentity,
			},
		});

		const allAllowedOps = [
			...new Set([...effectiveOps, 'describeFields', 'listPicklistValues', 'describeOperation']),
		];
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const supplyDataContext = this;
		const metadata = await resolveMetadataForTool(
			supplyDataContext,
			resource,
			effectiveOps,
			credentialIdentity,
			itemIndex,
		);
		if (metadata.cacheHit) {
			traceToolBuild({
				phase: 'metadata-cache-hit',
				resource,
				itemIndex,
				summary: {
					readFieldCount: metadata.readFields.length,
					writeFieldCount: metadata.writeFields.length,
					metadataHash: metadata.metadataHash,
				},
			});
		}

		const cachedArtifact = credentialIdentity !== null
			? getCachedEntry(artifactCache, getArtifactCacheKey(
				credentialIdentity,
				resource,
				effectiveOps,
				allowWriteOperations,
				supportsImpersonation,
				metadata.metadataHash,
			))
			: undefined;

		let schema: unknown;
		let descriptionTemplate: string;
		let schemaBuildDurationMs = 0;
		let descriptionBuildDurationMs = 0;
		if (cachedArtifact) {
			schema = cachedArtifact.schema;
			descriptionTemplate = cachedArtifact.descriptionTemplate;
			traceToolBuild({
				phase: 'artifact-cache-hit',
				resource,
				itemIndex,
				summary: {
					allAllowedOps: cachedArtifact.allAllowedOps,
				},
			});
		} else {
			const schemaBuildStart = Date.now();
			schema = buildUnifiedSchema(resource, effectiveOps, metadata.readFields, metadata.writeFields);
			schemaBuildDurationMs = Date.now() - schemaBuildStart;

			const descriptionBuildStart = Date.now();
			descriptionTemplate = buildUnifiedDescriptionTemplate(
				resourceLabel,
				resource,
				effectiveOps,
				metadata.readFields,
				metadata.writeFields,
				supportsImpersonation,
			);
			descriptionBuildDurationMs = Date.now() - descriptionBuildStart;

			if (credentialIdentity !== null) {
				setCachedEntry(
					artifactCache,
					getArtifactCacheKey(
						credentialIdentity,
						resource,
						effectiveOps,
						allowWriteOperations,
						supportsImpersonation,
						metadata.metadataHash,
					),
					{
						schema,
						descriptionTemplate,
						allAllowedOps,
						expiresAt: Date.now() + TOOL_BUILD_CACHE_TTL_MS,
					},
					MAX_CACHE_ENTRIES,
				);
				traceToolBuild({
					phase: 'artifact-cache-store',
					resource,
					itemIndex,
					summary: {
						schemaBuildDurationMs,
						descriptionBuildDurationMs,
					},
				});
			}
		}

		const description = injectDescriptionReferenceUtc(descriptionTemplate, referenceUtc);
		const schemaKeys = safeSchemaKeys(schema);
		traceToolBuild({
			phase: 'tool-built',
			resource,
			itemIndex,
			durationMs: Date.now() - supplyStart,
			summary: {
				toolName: `autotask_${resource}`,
				allAllowedOps,
				schemaFieldCount: schemaKeys.length,
				schemaTopLevelKeys: schemaKeys,
				descriptionLength: description.length,
				metadataCacheHit: metadata.cacheHit,
				metadataDurationMs: metadata.durationMs,
				schemaBuildDurationMs,
				descriptionBuildDurationMs,
				...(AI_TOOL_DEBUG_VERBOSE ? { descriptionPreview: redactForVerbose(description) } : {}),
			},
		});

		const unifiedTool = new RuntimeDynamicStructuredTool({
			name: `autotask_${resource}`,
			description,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			schema: schema as any,
			func: async (rawParams: Record<string, unknown>) => {
				const operation = rawParams.operation as string;
				if (!operation || !allAllowedOps.includes(operation)) {
					if (operation && isWriteOperation(operation) && !allowWriteOperations) {
						return JSON.stringify(
							wrapError(
								resource,
								operation,
								ERROR_TYPES.WRITE_OPERATION_BLOCKED,
								`Write operation '${operation}' is blocked. Enable "Allow Write Operations" in the node configuration.`,
								`Use a read operation such as 'get' or 'getMany', or ask the user to enable write operations.`,
							),
						);
					}
					return JSON.stringify(
						wrapError(
							resource,
							operation ?? 'unknown',
							ERROR_TYPES.INVALID_OPERATION,
							`Unknown operation '${operation}'.`,
							`Use one of: ${allAllowedOps.join(', ')}`,
						),
					);
				}
				return executeAiTool(
					supplyDataContext as unknown as IExecuteFunctions,
					resource,
					operation,
					rawParams as unknown as ToolExecutorParams,
					{
						readFields: metadata.readFields,
						writeFields: metadata.writeFields,
						allAllowedOps,
					},
				);
			},
		});

		// Wrap with logWrapper for n8n execution view visibility.
		// getLazyLogWrapper() returns null if @n8n/ai-utilities is unavailable
		// (graceful degradation — tool works without it).
		// ensureRuntime() was already called above via runtimeZod/RuntimeDynamicStructuredTool.
		const logWrapFn = getLazyLogWrapper();
		const wrappedTool = logWrapFn ? logWrapFn(unifiedTool, this) : unifiedTool;

		return { response: wrappedTool };
	}

	/**
	 * execute() serves two purposes:
	 *
	 * 1. Prevents n8n 2.8+ from falling through to the declarative RoutingNode
	 *    test path (which causes ERR_INVALID_URL — no requestDefaults/routing).
	 *
	 * 2. Handles Agent V3 (n8n ~1.116+) EngineRequest-based tool execution.
	 *    Agent V3 routes ALL tool calls through execute() with params in
	 *    item.json (including 'operation'), bypassing supplyData() → func().
	 *    The supplyData() → func() path is still used by Agent V2 and
	 *    MCP Trigger queue-mode workers.
	 *
	 * Because tool construction is expensive (API calls to describeResource),
	 * we process item.json directly here rather than rebuilding the tool.
	 * Framework-injected fields (Prompt__*, sessionId, etc.) are stripped
	 * by N8N_METADATA_FIELDS / N8N_METADATA_PREFIXES in executeAiTool().
	 */
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operations = this.getNodeParameter('operations', 0) as string[];
		const allowWriteOperations = this.getNodeParameter('allowWriteOperations', 0, false) as boolean;

		if (!resource || !operations?.length) {
			throw new NodeOperationError(
				this.getNode(),
				'Resource and at least one operation must be configured.',
			);
		}

		// Pick the first permitted operation as the default for test execution
		const effectiveOps = operations.filter(
			(op) => !isWriteOperation(op) || allowWriteOperations,
		);
		if (effectiveOps.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'No permitted operations. Enable "Allow Write Operations" if needed.',
			);
		}

		// Detect real tool invocation vs "Test step" in the editor.
		// n8n 2.14+ routes tool calls through execute() with params in item.json
		// (including 'operation'). Older versions set a 'tool' field. If neither
		// is present, this is an editor test step — return a friendly stub.
		const firstItem = items[0]?.json ?? {};
		const hasToolCall = !!(firstItem['tool'] || firstItem['operation']);
		if (!hasToolCall) {
			traceExecutor({
				phase: 'execute-test-step-stub',
				resource,
				summary: {
					path: 'test-step-stub',
				},
			});
			return [
				[
					{
						json: {
							message: 'This is an AI Tool node. Connect it to an AI Agent node to use it.',
							configured: { resource, operations },
						},
						pairedItem: { item: 0 },
					},
				],
			];
		}
		traceExecutor({
			phase: 'execute-agent-v3-path',
			resource,
			summary: {
				path: 'agent-v3',
				itemCount: items.length,
			},
		});

		// describeFields, listPicklistValues, and describeOperation are always available (same as supplyData path)
		const allAllowedOps = [
			...new Set([...effectiveOps, 'describeFields', 'listPicklistValues', 'describeOperation']),
		];
		const credentialIdentity = await resolveCredentialIdentity(this);
		const metadata = await resolveMetadataForTool(this, resource, effectiveOps, credentialIdentity);
		if (metadata.cacheHit) {
			traceToolBuild({
				phase: 'metadata-cache-hit',
				resource,
				summary: {
					path: 'execute',
					readFieldCount: metadata.readFields.length,
					writeFieldCount: metadata.writeFields.length,
					metadataHash: metadata.metadataHash,
				},
			});
		}

		// Retrieve (or cold-build) the Zod schema so execute() can strip unknown keys
		// from item.json — the same protection supplyData()->func() gets from parseAsync automatically.
		const supportsImpersonation = isNodeResourceImpersonationSupported(resource);
		let zodSchema: ZodSafeParseable;
		{
			const cachedArtifact = credentialIdentity !== null
				? getCachedEntry(artifactCache, getArtifactCacheKey(
					credentialIdentity,
					resource,
					effectiveOps,
					allowWriteOperations,
					supportsImpersonation,
					metadata.metadataHash,
				))
				: undefined;
			if (cachedArtifact) {
				zodSchema = cachedArtifact.schema as ZodSafeParseable;
			} else {
				// Cold-start: supplyData() hasn't run yet (Agent V3 first invocation).
				// Build the schema on demand and cache it for subsequent calls.
				const { buildUnifiedSchema } = getRuntimeSchemaBuilders(runtimeZod);
				const schema = buildUnifiedSchema(
					resource, effectiveOps, metadata.readFields, metadata.writeFields,
				);
				zodSchema = schema as ZodSafeParseable;
				if (credentialIdentity !== null) {
					const resourceLabel = formatResourceName(resource);
					const descriptionTemplate = buildUnifiedDescriptionTemplate(
						resourceLabel,
						resource,
						effectiveOps,
						metadata.readFields,
						metadata.writeFields,
						supportsImpersonation,
					);
					const allAllowedOpsCold = [
						...new Set([...effectiveOps, 'describeFields', 'listPicklistValues', 'describeOperation']),
					];
					setCachedEntry(
						artifactCache,
						getArtifactCacheKey(
							credentialIdentity,
							resource,
							effectiveOps,
							allowWriteOperations,
							supportsImpersonation,
							metadata.metadataHash,
						),
						{
							schema,
							descriptionTemplate,
							allAllowedOps: allAllowedOpsCold,
							expiresAt: Date.now() + TOOL_BUILD_CACHE_TTL_MS,
						},
						MAX_CACHE_ENTRIES,
					);
				}
			}
		}

		const response: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];
			if (!item) continue;

			const requestedOp = (item.json.operation as string) || effectiveOps[0];
			if (requestedOp && !allAllowedOps.includes(requestedOp)) {
				if (isWriteOperation(requestedOp) && !allowWriteOperations) {
					response.push({
						json: {
							...wrapError(
								resource,
								requestedOp,
								ERROR_TYPES.WRITE_OPERATION_BLOCKED,
								`Write operation '${requestedOp}' is blocked. Enable "Allow Write Operations" in the node configuration.`,
								`Use a read operation such as 'get' or 'getMany', or ask the user to enable write operations.`,
							),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				response.push({
					json: {
						...wrapError(
							resource,
							requestedOp,
							ERROR_TYPES.INVALID_OPERATION,
							`Operation '${requestedOp}' is not configured for this node.`,
							`Use one of: ${allAllowedOps.join(', ')}`,
						),
					},
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			const operation = requestedOp;

			try {
				// Pre-normalise: strip framework metadata and coerce null→undefined
				// BEFORE Zod parsing. Prevents:
				//   - "unknown key" noise from Prompt__*, sessionId, etc.
				//   - Parse failures when the LLM emits JSON null for "not applicable"
				//     fields whose schema is .optional() (not .nullish()).
				// Normalised output becomes the input to the Zod schema, which now
				// uses .nullish() on optional fields (see schema-generator.ts),
				// so null is also accepted at the schema level — the undefined
				// coercion here is belt-and-braces.
				const normalisedJson = stripAndNormaliseItemJson(item.json);
				// Zod strips any remaining unknown keys (defensive).
				const parseResult = zodSchema.safeParse(normalisedJson);
				if (!parseResult.success) {
					// Surface operation-contract violations (required/forbidden/xor)
					// when Zod parse fails. The Zod message alone says things like
					// "Expected number, received null" which doesn't tell the LLM
					// *why* the field matters. The contract registry knows which
					// fields are required for each operation — so run it against
					// the normalised input (same shape Zod just tried to parse)
					// and prepend those human-readable rules when they exist.
					// This is defense in depth: Zod catches type errors; the contract
					// check catches semantic/required-field violations that produce
					// a clearer, more actionable error message for the LLM.
					const contractViolations: OperationContractViolation[] =
						validateOperationContract(resource, operation, normalisedJson);
					const zodMessage = parseResult.error.message;
					const contractMessage = contractViolations
						.map((v) => v.message)
						.join(' ');
					const combinedSummary = contractViolations.length > 0
						? `${contractMessage} (Zod details: ${zodMessage})`
						: `Input validation failed: ${zodMessage}`;
					const nextAction = contractViolations.length > 0
						? `Call autotask_${resource} with operation '${operation}' and supply the missing/correct fields: ${contractMessage}`
						: `Check parameter names and types. Use autotask_${resource} with operation 'describeFields' to see valid fields.`;
					response.push({
						json: {
							...wrapError(
								resource,
								operation,
								ERROR_TYPES.INVALID_INPUT,
								combinedSummary,
								nextAction,
							),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				const params: ToolExecutorParams = {
					...parseResult.data,
					resource,
					operation,
				} as unknown as ToolExecutorParams;

				const resultJson = await executeAiTool(this, resource, operation, params, {
					readFields: metadata.readFields,
					writeFields: metadata.writeFields,
					allAllowedOps,
				});
				let parsed: IDataObject;
				if (typeof resultJson === 'string') {
					try {
						parsed = JSON.parse(resultJson);
					} catch {
						parsed = { error: resultJson };
					}
				} else {
					parsed = resultJson;
				}

				response.push({
					json: parsed,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				try {
					traceError({
						phase: 'execute-agent-v3-item',
						resource,
						operation,
						itemIndex,
						summary: { errorMessage: msg, beforeApiCall: true },
					});
				} catch {
					// best-effort: trace must not suppress the rethrow
				}
				throw new NodeOperationError(this.getNode(), msg, { itemIndex });
			}
		}

		return [response];
	}
}

async function getToolResources(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const options: INodePropertyOptions[] = [];
	for (const [value, ops] of Object.entries(RESOURCE_OPERATIONS_MAP)) {
		if (EXCLUDED_RESOURCES.includes(value)) continue;
		const hasSupportedToolOps = ops.some((o) => SUPPORTED_TOOL_OPERATIONS.includes(o));
		if (!hasSupportedToolOps) continue;
		options.push({
			name: formatResourceName(value),
			value,
			description: `${formatResourceName(value)} entity`,
		});
	}
	return options.sort((a, b) => a.name.localeCompare(b.name));
}

async function getToolResourceOperations(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resource = this.getCurrentNodeParameter('resource') as string;
	const allowWriteOperations = (this.getCurrentNodeParameter('allowWriteOperations') ??
		false) as boolean;

	if (!resource) return [];

	const ops = getResourceOperations(resource);
	const options: INodePropertyOptions[] = [];

	for (const op of ops) {
		if (!SUPPORTED_TOOL_OPERATIONS.includes(op)) continue;
		if (isWriteOperation(op) && !allowWriteOperations) continue;
		const metadata = getOperationMetadata(op);
		options.push({
			name: metadata?.label ?? op,
			value: op,
			description: `${op} operation`,
		});
	}
	return options;
}
