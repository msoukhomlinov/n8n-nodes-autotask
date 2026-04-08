import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { autotaskApiRequest } from '../../helpers/http';

const ENTITY_TYPE = 'timeOffRequest';

export async function executeTimeOffRequestOperation(
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
					returnData.push({ json: response as unknown as IDataObject });
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

				case 'approve': {
					const id = this.getNodeParameter('id', i) as string;
					const response = await autotaskApiRequest.call(
						this,
						'GET',
						`TimeOffRequests/${id}/Approve`,
					);
					returnData.push({ json: (response || { success: true }) as IDataObject });
					break;
				}

				case 'reject': {
					const id = this.getNodeParameter('id', i) as string;
					const rejectReason = this.getNodeParameter('rejectReason', i, '') as string;
					const response = await autotaskApiRequest.call(
						this,
						'POST',
						`TimeOffRequests/${id}/Reject`,
						{ timeOffRequestID: Number(id), reason: rejectReason },
					);
					returnData.push({ json: (response || { success: true }) as IDataObject });
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
