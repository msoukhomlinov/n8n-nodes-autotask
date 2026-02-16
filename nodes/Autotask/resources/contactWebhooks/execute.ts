import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	DeleteOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'contactWebhook';

export async function executeContactWebhookOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'contact');
					const response = await getOp.execute(i);
					returnData.push({ json: response as unknown as IDataObject });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'contact' });
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}
				case 'delete': {
					const entityId = this.getNodeParameter('id', i) as string;
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await deleteOp.execute(i);
					if (response && typeof response === 'object' && 'dryRun' in response) {
						returnData.push({ json: response as unknown as IDataObject });
					} else {
						returnData.push({
							json: {
								success: true,
								id: entityId,
								message: `Contact Webhook with ID ${entityId} was successfully deleted`,
							},
						});
					}
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
