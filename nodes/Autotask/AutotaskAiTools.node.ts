import { NodeOperationError } from 'n8n-workflow';
import type {
    NodeConnectionType,
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

const { buildUnifiedSchema } = getRuntimeSchemaBuilders(runtimeZod);

const WRITE_OPERATIONS = ['create', 'moveToCompany', 'moveConfigurationItem', 'transferOwnership', 'update', 'delete'];
const SUPPORTED_TOOL_OPERATIONS = [
    'get',
    'getMany',
    'searchByDomain',
    'getPosted',
    'getUnposted',
    'count',
    'create',
    'moveToCompany',
    'moveConfigurationItem',
    'transferOwnership',
    'update',
    'delete',
    'whoAmI',
    'slaHealthCheck',
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
        outputs: [{ type: 'ai_tool' as NodeConnectionType, displayName: 'Tools' }],
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
                description: 'Whether to enable mutating tools (create, moveToCompany, moveConfigurationItem, transferOwnership, update, delete). Disabled = read-only.',
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
            ['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI', 'searchByDomain'].includes(op),
        );
        const needsWriteFields = effectiveOps.some((op) => ['create', 'update'].includes(op));

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
     * execute() is required so that n8n 2.8+ does not fall through to the
     * declarative RoutingNode test path (which causes ERR_INVALID_URL because
     * there is no requestDefaults / routing config on this node).
     *
     * When the AI Agent invokes a tool at runtime the call goes through
     * supplyData → DynamicStructuredTool.func — it never hits execute().
     * This method only runs when the node is executed directly (e.g. "Test
     * step" in the editor) or via the internal executeDeclarativeNodeInTest
     * code path.
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

        // When run via "Test step" in the editor there is no tool field — return a friendly stub.
        const firstItemTool = items[0]?.json?.['tool'] as string | undefined;
        if (!firstItemTool) {
            return [[{
                json: {
                    message: 'This is an AI Tool node. Connect it to an AI Agent node to use it.',
                    configured: { resource, operations },
                },
                pairedItem: { item: 0 },
            }]];
        }

        const response: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            if (!item) continue;

            const requestedOp = (item.json.operation as string) || effectiveOps[0];
            if (requestedOp && !effectiveOps.includes(requestedOp)) {
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
                        `Use one of: ${effectiveOps.join(', ')}`,
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

                const resultJson = await executeAiTool(this, resource, operation, params);
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
