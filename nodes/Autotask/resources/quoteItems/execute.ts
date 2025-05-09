import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
	DeleteOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'quoteItem';

export async function executeQuoteItemOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					console.log('Debug: Starting quote item create operation');
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created CreateOperation instance');

					const response = await createOp.execute(i);
					console.log('Debug: Create operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'update': {
					console.log('Debug: Starting quote item update operation');
					const entityId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created UpdateOperation instance');

					const response = await updateOp.execute(i, entityId);
					console.log('Debug: Update operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'get': {
					console.log('Debug: Starting quote item get operation');
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'quote');
					console.log('Debug: Created GetOperation instance');

					const response = await getOp.execute(i);
					console.log('Debug: Get operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting quote item getMany operation');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'quote' });
					console.log('Debug: Created GetManyOperation instance');

					const filters = getManyOp.buildFiltersFromResourceMapper(i);
					console.log('Debug: Built filters:', filters);

					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response length:', Array.isArray(response) ? response.length : 0);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					console.log('Debug: Starting quote item getManyAdvanced operation');
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'quote' });
					console.log('Debug: GetManyAdvanced operation results length:', results.length);
					returnData.push(...results);
					break;
				}

				case 'count': {
					console.log('Debug: Starting quote item count operation');
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created CountOperation instance');

					const count = await countOp.execute(i);
					console.log('Debug: Count operation result:', count);
					returnData.push({
						json: {
							count,
							entityType: ENTITY_TYPE,
						},
					});
					break;
				}

				case 'delete': {
					console.log('Debug: Starting quote item delete operation');
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created DeleteOperation instance');

					const response = await deleteOp.execute(i);
					console.log('Debug: Delete operation response:', response);
					returnData.push({ json: { success: true } });
					break;
				}

				case 'getEntityInfo':
				case 'getFieldInfo': {
					console.log('Debug: Starting quote item entity info operation');
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i, 'quote');
					console.log('Debug: Entity info operation completed');
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
