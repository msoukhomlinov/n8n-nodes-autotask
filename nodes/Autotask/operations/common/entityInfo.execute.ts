import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import { GetEntityInfoOperation } from '../base/getEntityInfo.operation';
import { GetFieldInfoOperation } from '../base/getFieldInfo.operation';

/**
 * Execute entity info operations
 */
export async function executeEntityInfoOperations(
	operation: string,
	entityType: string,
	context: IExecuteFunctions,
	itemIndex: number,
	parentType?: string,
	parentChain?: string[],
): Promise<INodeExecutionData> {
	switch (operation) {
		case 'getEntityInfo': {
			const getEntityInfoOp = new GetEntityInfoOperation<IAutotaskEntity>(
				entityType,
				context,
				parentType,
				parentChain,
			);
			return getEntityInfoOp.execute(itemIndex);
		}
		case 'getFieldInfo': {
			const getFieldInfoOp = new GetFieldInfoOperation(
				entityType,
				context,
				parentType,
				parentChain,
			);
			return getFieldInfoOp.execute();
		}
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}
