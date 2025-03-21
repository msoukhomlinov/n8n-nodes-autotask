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

const ENTITY_TYPE = 'ConfigurationItemBillingProductAssociations';

export async function executeConfigurationItemBillingProductAssociationOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					console.log('Debug: Starting create operation');
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created operation instance');

					const response = await createOp.execute(i);
					console.log('Debug: Operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'update': {
					console.log('Debug: Starting update operation');
					const entityId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created UpdateOperation instance');

					const response = await updateOp.execute(i, entityId);
					console.log('Debug: Update operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'get': {
					console.log('Debug: Starting get operation');
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'configurationItem');
					console.log('Debug: Created GetOperation instance');

					const response = await getOp.execute(i);
					console.log('Debug: Get operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting getMany operation');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'configurationItem' });
					console.log('Debug: Created GetManyOperation instance');

					const filters = getManyOp.buildFiltersFromResourceMapper(i);
					console.log('Debug: Built filters:', filters);
					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response:', response);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					console.log('Debug: Starting getManyAdvanced operation');
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'configurationItem' });
					console.log('Debug: GetManyAdvanced operation results:', results);
					returnData.push(...results);
					break;
				}

				case 'delete': {
					console.log('Debug: Starting delete operation');
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created DeleteOperation instance');

					await deleteOp.execute(i);
					console.log('Debug: Delete operation completed successfully');
					returnData.push({
						json: {
							success: true,
							message: 'Billing product association deleted successfully'
						}
					});
					break;
				}

				case 'count': {
					console.log('Debug: Starting count operation');
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

				case 'getEntityInfo':
				case 'getFieldInfo': {
					console.log(`Debug: Starting ${operation} operation`);
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i, 'configurationItem');
					console.log(`Debug: ${operation} operation response:`, response);
					returnData.push(response as INodeExecutionData);
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
