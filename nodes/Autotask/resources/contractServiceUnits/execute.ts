import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'contractServiceUnit';

export async function executeContractServiceUnitOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					console.log('Debug: Starting get operation for contract service unit');
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'contract');
					console.log('Debug: Created GetOperation instance');

					const response = await getOp.execute(i);
					console.log('Debug: Get operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting getMany operation for contract service unit');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'contract' });
					console.log('Debug: Created GetManyOperation instance');

					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					console.log('Debug: Built filters from resource mapper');

					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response length:', response.length);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}
				case 'count': {
					console.log('Debug: Starting count operation for contract service unit');
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created CountOperation instance');

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
				default:
					throw new Error(`Operation ${operation} is not supported`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: error.message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
