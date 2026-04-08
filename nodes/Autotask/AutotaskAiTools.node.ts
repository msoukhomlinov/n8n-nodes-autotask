import { NodeOperationError } from 'n8n-workflow';
import type {
    IDataObject,
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
import { describeResource } from './helpers/aiHelper';
import { executeAiTool, type ToolExecutorParams } from './ai-tools/tool-executor';
import { buildUnifiedDescription } from './ai-tools/description-builders';
import { RuntimeDynamicStructuredTool, runtimeZod } from './ai-tools/runtime';
import { getRuntimeSchemaBuilders } from './ai-tools/schema-generator';
import { isNodeResourceImpersonationSupported } from './helpers/impersonation';
import { wrapError, ERROR_TYPES } from './ai-tools/error-formatter';

const WRITE_OPERATIONS = ['create', 'createIfNotExists', 'moveToCompany', 'moveConfigurationItem', 'transferOwnership', 'update', 'approve', 'reject', 'delete'];
const SUPPORTED_TOOL_OPERATIONS = [
    'get',
    'getMany',
    'searchByDomain',
    'getPosted',
    'getUnposted',
    'getByResource',
    'getByYear',
    'count',
    'create',
    'moveToCompany',
    'moveConfigurationItem',
    'transferOwnership',
    'update',
    'delete',
    'whoAmI',
    'slaHealthCheck',
    'createIfNotExists',
    'approve',
    'reject',
];
const EXCLUDED_RESOURCES = ['aiHelper', 'apiThreshold'];

function formatResourceName(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, ' $1').trim();
}

// ---------------------------------------------------------------------------
// Node class
// ---------------------------------------------------------------------------

export class AutotaskAiTools implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Autotask AI Tools',
        name: 'autotaskAiTools',
        icon: 'file:autotask.svg',
        group: ['output'],
        usableAsTool: true,
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
                description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
                description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            },
            {
                displayName: 'Allow Write Operations',
                name: 'allowWriteOperations',
                type: 'boolean',
                default: false,
                description: 'Whether to enable mutating tools (create, createIfNotExists, moveToCompany, moveConfigurationItem, transferOwnership, update, delete). Disabled = read-only.',
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
        const allowWriteOperations = this.getNodeParameter('allowWriteOperations', itemIndex, false) as boolean;

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
            (op) => !WRITE_OPERATIONS.includes(op) || allowWriteOperations,
        );
        if (effectiveOps.length === 0) {
            throw new NodeOperationError(
                this.getNode(),
                'No permitted operations. Enable "Allow Write Operations" if write operations are needed.',
            );
        }

        const resourceLabel = formatResourceName(resource);
        const referenceUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const supportsImpersonation = isNodeResourceImpersonationSupported(resource);

        // Fetch field metadata once — reused by schema + description + executor
        const needsReadFields = effectiveOps.some((op) =>
            ['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain', 'getByResource', 'getByYear'].includes(op),
        );
        const needsWriteFields = effectiveOps.some((op) => ['create', 'createIfNotExists', 'update'].includes(op));

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const supplyDataContext = this;

        const [readDescribe, writeDescribe] = await Promise.all([
            needsReadFields
                ? describeResource(supplyDataContext as unknown as ILoadOptionsFunctions, resource, 'read')
                : Promise.resolve(undefined),
            needsWriteFields
                ? describeResource(supplyDataContext as unknown as ILoadOptionsFunctions, resource, 'write')
                : Promise.resolve(undefined),
        ]);

        const schema = buildUnifiedSchema(
            resource,
            effectiveOps,
            readDescribe?.fields ?? [],
            writeDescribe?.fields ?? [],
        );

        const description = buildUnifiedDescription(
            resourceLabel,
            resource,
            effectiveOps,
            readDescribe?.fields ?? [],
            writeDescribe?.fields ?? [],
            referenceUtc,
            supportsImpersonation,
        );

        const allAllowedOps = [...new Set([...effectiveOps, 'describeFields', 'listPicklistValues'])];

        const unifiedTool = new RuntimeDynamicStructuredTool({
            name: `autotask_${resource}`,
            description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schema: schema as any,
            func: async (rawParams: Record<string, unknown>) => {
                const operation = rawParams.operation as string;
                if (!operation || !allAllowedOps.includes(operation)) {
                    if (operation && WRITE_OPERATIONS.includes(operation) && !allowWriteOperations) {
                        return JSON.stringify(wrapError(
                            resource, operation, ERROR_TYPES.WRITE_OPERATION_BLOCKED,
                            `Write operation '${operation}' is blocked. Enable "Allow Write Operations" in the node configuration.`,
                            `Use a read operation such as 'get' or 'getMany', or ask the user to enable write operations.`,
                        ));
                    }
                    return JSON.stringify(wrapError(
                        resource, operation ?? 'unknown', ERROR_TYPES.INVALID_OPERATION,
                        `Unknown operation '${operation}'.`,
                        `Use one of: ${allAllowedOps.join(', ')}`,
                    ));
                }
                return executeAiTool(
                    supplyDataContext as unknown as IExecuteFunctions,
                    resource,
                    operation,
                    rawParams as unknown as ToolExecutorParams,
                    {
                        readFields: readDescribe?.fields ?? [],
                        writeFields: writeDescribe?.fields ?? [],
                    },
                );
            },
        });

        return { response: unifiedTool };
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
            (op) => !WRITE_OPERATIONS.includes(op) || allowWriteOperations,
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
            return [[{
                json: {
                    message: 'This is an AI Tool node. Connect it to an AI Agent node to use it.',
                    configured: { resource, operations },
                },
                pairedItem: { item: 0 },
            }]];
        }

        // describeFields and listPicklistValues are always available (same as supplyData path)
        const allAllowedOps = [...new Set([...effectiveOps, 'describeFields', 'listPicklistValues'])];

        // Fetch field metadata for label resolution and field validation (mirrors supplyData)
        const needsReadFields = effectiveOps.some((op) =>
            ['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain', 'getByResource', 'getByYear'].includes(op),
        );
        const needsWriteFields = effectiveOps.some((op) => ['create', 'createIfNotExists', 'update'].includes(op));

        const [readDescribe, writeDescribe] = await Promise.all([
            needsReadFields
                ? describeResource(this as unknown as ILoadOptionsFunctions, resource, 'read')
                : Promise.resolve(undefined),
            needsWriteFields
                ? describeResource(this as unknown as ILoadOptionsFunctions, resource, 'write')
                : Promise.resolve(undefined),
        ]);

        const response: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            if (!item) continue;

            const requestedOp = (item.json.operation as string) || effectiveOps[0];
            if (requestedOp && !allAllowedOps.includes(requestedOp)) {
                if (WRITE_OPERATIONS.includes(requestedOp) && !allowWriteOperations) {
                    response.push({
                        json: { ...wrapError(
                            resource, requestedOp, ERROR_TYPES.WRITE_OPERATION_BLOCKED,
                            `Write operation '${requestedOp}' is blocked. Enable "Allow Write Operations" in the node configuration.`,
                            `Use a read operation such as 'get' or 'getMany', or ask the user to enable write operations.`,
                        ) },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                response.push({
                    json: { ...wrapError(
                        resource, requestedOp, ERROR_TYPES.INVALID_OPERATION,
                        `Operation '${requestedOp}' is not configured for this node.`,
                        `Use one of: ${allAllowedOps.join(', ')}`,
                    ) },
                    pairedItem: { item: itemIndex },
                });
                continue;
            }
            const operation = requestedOp;

            try {
                const params: ToolExecutorParams = {
                    ...(item.json as Record<string, unknown>),
                    resource,
                    operation,
                } as unknown as ToolExecutorParams;

                const resultJson = await executeAiTool(this, resource, operation, params, {
                    readFields: readDescribe?.fields ?? [],
                    writeFields: writeDescribe?.fields ?? [],
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

async function getToolResourceOperations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const resource = this.getCurrentNodeParameter('resource') as string;
    const allowWriteOperations = (this.getCurrentNodeParameter('allowWriteOperations') ?? false) as boolean;

    if (!resource) return [];

    const ops = getResourceOperations(resource);
    const options: INodePropertyOptions[] = [];

    const opLabels: Record<string, string> = {
        get: 'Get by ID',
        whoAmI: 'Who am I',
        getMany: 'Get many (with filters)',
        searchByDomain: 'Search by domain',
        slaHealthCheck: 'SLA health check',
        getPosted: 'Get posted time entries',
        getUnposted: 'Get unposted time entries',
        count: 'Count',
        create: 'Create',
        moveToCompany: 'Move contact to company',
        moveConfigurationItem: 'Move configuration item (clone to company)',
        transferOwnership: 'Transfer ownership',
        update: 'Update',
        delete: 'Delete',
        createIfNotExists: 'Create If Not Exists (idempotent)',
        getByResource: 'Get by resource',
        getByYear: 'Get by resource and year',
        approve: 'Approve time off request',
        reject: 'Reject time off request',
    };

    for (const op of ops) {
        if (!SUPPORTED_TOOL_OPERATIONS.includes(op)) continue;
        if (WRITE_OPERATIONS.includes(op) && !allowWriteOperations) continue;
        options.push({
            name: opLabels[op] ?? op,
            value: op,
            description: `${op} operation`,
        });
    }
    return options;
}
