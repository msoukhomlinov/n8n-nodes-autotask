import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'CompanySiteConfigurations';

export async function executeCompanySiteConfigurationOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
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
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'company');
					console.log('Debug: Created GetOperation instance');
					const response = await getOp.execute(i);
					console.log('Debug: Get operation response:', response);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting getMany operation');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'company' });
					console.log('Debug: Created GetManyOperation instance');
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response:', response);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					console.log('Debug: Starting getManyAdvanced operation');
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'company' });
					console.log('Debug: getManyAdvanced operation results:', results);
					returnData.push(...results);
					break;
				}

				case 'count': {
					console.log('Debug: Starting count operation');
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

				case 'getEntityInfo':
				case 'getFieldInfo': {
					console.log('Debug: Starting entity info operation');
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i, 'company');
					console.log('Debug: Entity info operation response:', response);
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
