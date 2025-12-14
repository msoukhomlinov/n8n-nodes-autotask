import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetOperation,
	GetManyOperation,
	DeleteOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'ticketWebhook';

export async function executeTicketWebhookOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'ticket');
					const response = await getOp.execute(i);
					returnData.push({ json: response as unknown as IDataObject });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'ticket' });
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'ticket' });
					returnData.push(...results);
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
								message: `Ticket Webhook with ID ${entityId} was successfully deleted`,
							},
						});
					}
					break;
				}

				case 'getEntityInfo':
				case 'getFieldInfo': {
					const response = await executeEntityInfoOperations(
						operation,
						ENTITY_TYPE,
						this,
						i,
						'ticket',
					);
					returnData.push(response);
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
