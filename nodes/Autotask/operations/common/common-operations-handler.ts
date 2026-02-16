import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import {
    getCommonOpContext,
    isCommonOperation,
    type ICommonOpContext,
} from '../../helpers/common-operations-context';
import { executeEntityInfoOperations } from './entityInfo.execute';
import { handleGetManyAdvancedOperation } from './get-many-advanced';

/**
 * Execute a common operation (getEntityInfo, getFieldInfo, getManyAdvanced) from the central layer.
 * Used by the main node and tool executor before delegating to resource executors.
 *
 * @returns Execution result, or null if the resource is not a known entity (caller should fall back to resource executor).
 */
export async function executeCommonOperation(
    this: IExecuteFunctions,
    resource: string,
    operation: string,
    itemIndex: number,
): Promise<INodeExecutionData[][] | null> {
    if (!isCommonOperation(operation)) {
        return null;
    }

    const ctx = getCommonOpContext(resource);
    if (!ctx) {
        return null;
    }

    if (operation === 'getEntityInfo' || operation === 'getFieldInfo') {
        const result = await executeEntityInfoOrFieldInfo(this, operation, ctx, itemIndex);
        return result;
    }

    if (operation === 'getManyAdvanced') {
        const result = await executeGetManyAdvancedCentral(this, ctx, itemIndex);
        return result;
    }

    return null;
}

async function executeEntityInfoOrFieldInfo(
    context: IExecuteFunctions,
    operation: string,
    ctx: ICommonOpContext,
    itemIndex: number,
): Promise<INodeExecutionData[][]> {
    const response = await executeEntityInfoOperations(
        operation,
        ctx.entityType,
        context,
        itemIndex,
        ctx.parentType,
        ctx.parentChain,
    );
    return [[response]];
}

async function executeGetManyAdvancedCentral(
    context: IExecuteFunctions,
    ctx: ICommonOpContext,
    itemIndex: number,
): Promise<INodeExecutionData[][]> {
    const results = await handleGetManyAdvancedOperation.call(context, ctx.entityType, itemIndex);
    return [results];
}
