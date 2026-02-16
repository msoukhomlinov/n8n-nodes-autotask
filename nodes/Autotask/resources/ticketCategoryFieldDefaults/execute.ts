import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'ticketCategoryFieldDefault';

export async function executeTicketCategoryFieldDefaultOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}
				case 'count': {
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const count = await countOp.execute(i);
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
