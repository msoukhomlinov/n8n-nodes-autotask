import {
    NodeConnectionType,
    NodeOperationError,
} from 'n8n-workflow';
import type {
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeType,
    INodeTypeDescription,
    INodePropertyOptions,
    INodeExecutionData,
    ISupplyDataFunctions,
    SupplyData,
} from 'n8n-workflow';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { z } from 'zod';
import { RESOURCE_OPERATIONS_MAP, getResourceOperations } from './constants/resource-operations';
import { describeResource, type DescribeResourceResponse } from './helpers/aiHelper';
import {
    getGetSchema,
    getWhoAmISchema,
    getGetManySchema,
    getCompanySearchByDomainSchema,
    getCountSchema,
    getDeleteSchema,
    getCreateSchema,
    getUpdateSchema,
} from './ai-tools/schema-generator';
import { executeAiTool, type ToolExecutorParams } from './ai-tools/tool-executor';
import {
    buildCountDescription,
    buildCreateDescription,
    buildDeleteDescription,
    buildGetDescription,
    buildGetManyDescription,
    buildCompanySearchByDomainDescription,
    buildPostedTimeEntriesDescription,
    buildUnpostedTimeEntriesDescription,
    buildUpdateDescription,
    buildWhoAmIDescription,
} from './ai-tools/description-builders';
import { buildHelperTools } from './ai-tools/helper-tools';
import { normaliseToolInputSchema } from './ai-tools/schema-normalizer';

// ---------------------------------------------------------------------------
// Resolve n8n-core's StructuredToolkit at runtime.
// n8n-core is always present in the n8n host but is not a declared dependency
// for community node packages. Using the host's class ensures instanceof checks
// in n8n's agent tool-consumption flow (getConnectedTools / extendResponseMetadata)
// recognise our toolkit correctly — matching exactly what n8n's own MCP Client
// Tool node does: `import { StructuredToolkit } from 'n8n-core'`.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { StructuredToolkit } = require('n8n-core') as {
    StructuredToolkit: new (tools: DynamicStructuredTool[]) => { tools: DynamicStructuredTool[] };
};

const WRITE_OPERATIONS = ['create', 'update', 'delete'];
const SUPPORTED_TOOL_OPERATIONS = ['get', 'getMany', 'searchByDomain', 'getPosted', 'getUnposted', 'count', 'create', 'update', 'delete', 'whoAmI'];
const EXCLUDED_RESOURCES = ['aiHelper', 'apiThreshold'];

function formatResourceName(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replace(/([A-Z])/g, ' $1').trim();
}

function parseOperationFromToolName(toolName: unknown, resource: string): string | undefined {
    if (typeof toolName !== 'string' || !toolName.trim()) {
        return undefined;
    }
    const trimmedToolName = toolName.trim();
    const prefix = `autotask_${resource.toLowerCase()}_`;
    const lowerToolName = trimmedToolName.toLowerCase();
    if (!lowerToolName.startsWith(prefix)) {
        return undefined;
    }
    return lowerToolName.slice(prefix.length);
}

function resolveOperationCaseInsensitive(
    requestedOperation: string,
    allowedOperations: string[],
): string | undefined {
    const normalisedRequested = requestedOperation.trim().toLowerCase();
    return allowedOperations.find((op) => op.toLowerCase() === normalisedRequested);
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
        version: 1,
        description: 'Expose Autotask operations as individual AI tools for the AI Agent',
        defaults: {
            name: 'Autotask AI Tools',
        },
        inputs: [],
        outputs: [{ type: NodeConnectionType.AiTool, displayName: 'Tools' }],
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
                description: 'Whether to enable create, update, delete tools. Disabled = read-only.',
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

        const resourceLabel = formatResourceName(resource);
        const tools: DynamicStructuredTool[] = [];
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for async closure in tool func
        const supplyDataContext = this;

        // Fetch field metadata once for the resource -- used by multiple operations
        const needsReadFields = operations.some((op) => ['get', 'getMany', 'getPosted', 'getUnposted', 'count', 'whoAmI'].includes(op));
        const needsWriteFields = operations.some((op) => ['create', 'update'].includes(op));

        let readDescribe: DescribeResourceResponse | undefined;
        let writeDescribe: DescribeResourceResponse | undefined;

        if (needsReadFields) {
            readDescribe = await describeResource(
                supplyDataContext as unknown as ILoadOptionsFunctions,
                resource,
                'read',
            );
        }
        if (needsWriteFields) {
            writeDescribe = await describeResource(
                supplyDataContext as unknown as ILoadOptionsFunctions,
                resource,
                'write',
            );
        }

        for (const operation of operations) {
            if (WRITE_OPERATIONS.includes(operation) && !allowWriteOperations) {
                continue;
            }

            const toolName = `autotask_${resource}_${operation}`;
            let schema: z.ZodObject<z.ZodRawShape>;
            let description: string;

            switch (operation) {
                case 'get':
                    schema = getGetSchema();
                    description = buildGetDescription(resourceLabel, resource);
                    break;
                case 'whoAmI':
                    schema = getWhoAmISchema();
                    description = buildWhoAmIDescription(resourceLabel);
                    break;
                case 'getMany':
                    schema = getGetManySchema(readDescribe?.fields ?? []);
                    description = buildGetManyDescription(resourceLabel, resource, readDescribe?.fields ?? []);
                    break;
                case 'searchByDomain':
                    schema = getCompanySearchByDomainSchema();
                    description = buildCompanySearchByDomainDescription(resource);
                    break;
                case 'getPosted':
                    schema = getGetManySchema(readDescribe?.fields ?? []);
                    description = buildPostedTimeEntriesDescription(resource);
                    break;
                case 'getUnposted':
                    schema = getGetManySchema(readDescribe?.fields ?? []);
                    description = buildUnpostedTimeEntriesDescription(resource);
                    break;
                case 'count':
                    schema = getCountSchema(readDescribe?.fields ?? []);
                    description = buildCountDescription(resourceLabel);
                    break;
                case 'delete':
                    schema = getDeleteSchema();
                    description = buildDeleteDescription(resourceLabel);
                    break;
                case 'create': {
                    const fields = writeDescribe?.fields ?? [];
                    schema = getCreateSchema(fields);
                    description = buildCreateDescription(resourceLabel, resource, fields);
                    break;
                }
                case 'update': {
                    const fields = writeDescribe?.fields ?? [];
                    schema = getUpdateSchema(fields);
                    description = buildUpdateDescription(resourceLabel, resource);
                    break;
                }
                default:
                    continue;
            }

            const tool = new DynamicStructuredTool({
                name: toolName,
                description,
                schema: normaliseToolInputSchema(schema),
                func: async (params: Record<string, unknown>) => {
                    const typedParams = params as unknown as ToolExecutorParams;
                    return executeAiTool(
                        supplyDataContext as unknown as IExecuteFunctions,
                        resource,
                        operation,
                        typedParams,
                        {
                            readFields: readDescribe?.fields ?? [],
                            writeFields: writeDescribe?.fields ?? [],
                        },
                    );
                },
            });
            tools.push(tool);
        }

        const helperTools = buildHelperTools(
            resource,
            resourceLabel,
            supplyDataContext as unknown as IExecuteFunctions,
        );
        tools.push(...helperTools);

        if (tools.length === 0) {
            throw new NodeOperationError(
                this.getNode(),
                'No tools to expose. Select operations and enable "Allow Write Operations" if you need create/update/delete.',
            );
        }

        // Wrap in n8n-core's StructuredToolkit so the AI Agent's getConnectedTools
        // correctly recognises and flattens the tools (instanceof StructuredToolkit).
        const toolkit = new StructuredToolkit(tools);
        return { response: toolkit };
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

        const response: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            if (!item) continue;

            // Execution payload may provide operation directly, or provide a tool name.
            // In AI mode the payload often includes `tool: autotask_<resource>_<operation>`.
            const requestedOpFromName =
                parseOperationFromToolName(item.json.tool, resource) ??
                parseOperationFromToolName(item.json.toolName, resource);
            const requestedOp = (item.json.operation as string) || requestedOpFromName || effectiveOps[0];
            const operation = resolveOperationCaseInsensitive(requestedOp, effectiveOps) ?? effectiveOps[0];

            try {
                const params: ToolExecutorParams = {
                    ...(item.json as Record<string, unknown>),
                    resource,
                    operation,
                } as unknown as ToolExecutorParams;

                const resultJson = await executeAiTool(this, resource, operation, params);
                const parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;

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
        getPosted: 'Get posted time entries',
        getUnposted: 'Get unposted time entries',
        count: 'Count',
        create: 'Create',
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
