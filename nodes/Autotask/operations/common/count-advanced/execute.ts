import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { CountAdvancedOperation } from '../../base/count-advanced.operation';
import type { IAutotaskEntity } from '../../../types';

export async function executeCountAdvanced(
    this: IExecuteFunctions,
    entityType: string,
    itemIndex: number,
): Promise<INodeExecutionData[]> {
    const operation = new CountAdvancedOperation<IAutotaskEntity>(entityType, this);
    const count = await operation.execute(itemIndex);
    return [{ json: { count, entityType } }];
}

export function handleCountAdvancedOperation(
    this: IExecuteFunctions,
    entityType: string,
    itemIndex: number,
): Promise<INodeExecutionData[]> {
    return executeCountAdvanced.call(this, entityType, itemIndex);
}
