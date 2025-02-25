import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../../types';
import { GetManyAdvancedOperation } from '../../base/get-many-advanced.operation';

/**
 * Execute getManyAdvanced operation
 */
export async function executeGetManyAdvanced(
	this: IExecuteFunctions,
	entityType: string,
	itemIndex: number,
	options?: {
		pageSize?: number;
		maxPages?: number;
		isPicklistQuery?: boolean;
		picklistFields?: string[];
		parentType?: string;
	},
): Promise<INodeExecutionData[]> {
	const operation = new GetManyAdvancedOperation<IAutotaskEntity>(entityType, this, options);
	const results = await operation.execute(itemIndex);
	return results.map(item => ({ json: item }));
}

/**
 * Common handler for getManyAdvanced operation
 */
export function handleGetManyAdvancedOperation(
	this: IExecuteFunctions,
	entityType: string,
	itemIndex: number,
	options?: {
		pageSize?: number;
		maxPages?: number;
		isPicklistQuery?: boolean;
		picklistFields?: string[];
		parentType?: string;
	},
): Promise<INodeExecutionData[]> {
	return executeGetManyAdvanced.call(this, entityType, itemIndex, options);
}
