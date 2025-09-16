import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'classificationIcon';

export async function executeClassificationIconOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					console.log('Debug: Starting get operation');
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getOp.execute(i);
					console.log('Debug: Get operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting getMany operation');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response count:', response.length);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					console.log('Debug: Starting getManyAdvanced operation');
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
					console.log('Debug: GetManyAdvanced operation response count:', results.length);
					returnData.push(...results);
					break;
				}

				case 'count': {
					console.log('Debug: Starting count operation');
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const count = await countOp.execute(i);
					console.log('Debug: Count operation response:', count);
					returnData.push({
						json: {
							count,
							entityType: ENTITY_TYPE,
						},
					});
					break;
				}

				case 'getEntityInfo':
				case 'getFieldInfo': {
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
					returnData.push(response);
					break;
				}

				default:
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported!`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ error: error.message, json: {} });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
