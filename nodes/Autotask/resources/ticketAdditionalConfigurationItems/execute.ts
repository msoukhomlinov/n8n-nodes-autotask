import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
	DeleteOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'ticketAdditionalConfigurationItem';

export async function executeTicketAdditionalConfigurationItemOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await createOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'delete': {
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await deleteOp.execute(i);
					returnData.push({ json: (response || { success: true }) as IDataObject });
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'ticket');
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'ticket' });
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

				case 'createIfNotExists': {
					const { createTicketAdditionalCIIfNotExists } = await import('../../helpers/ticket-additional-ci-creator');
					let createFields: Record<string, unknown> = {};
					try {
						const fieldsToMap = this.getNodeParameter('fieldsToMap', i, { value: {} }) as { value: Record<string, unknown> | null };
						createFields = fieldsToMap?.value ?? {};
					} catch { /* fieldsToMap may not be available */ }
					const result = await createTicketAdditionalCIIfNotExists(this, i, {
						createFields,
						dedupFields: this.getNodeParameter('dedupFields', i, []) as string[],
						errorOnDuplicate: this.getNodeParameter('errorOnDuplicate', i, false) as boolean,
					});
					returnData.push({ json: result as unknown as IDataObject });
					break;
				}

				default:
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported!`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
