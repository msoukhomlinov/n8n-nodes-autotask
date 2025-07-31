import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'phase';  // Matches API endpoint

export async function executeProjectPhaseOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					console.log('Debug: Starting create operation for project phase');
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created CreateOperation instance');

					const response = await createOp.execute(i);
					console.log('Debug: Create operation response:', response);

					returnData.push({ json: response });
					break;
				}

				case 'update': {
					console.log('Debug: Starting update operation for project phase');
					const entityId = this.getNodeParameter('id', i) as string;
					console.log('Debug: Retrieved entityId:', entityId);

					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created UpdateOperation instance');

					const response = await updateOp.execute(i, entityId);
					console.log('Debug: Update operation response:', response);

					returnData.push({ json: response });
					break;
				}

				case 'get': {
					console.log('Debug: Starting get operation for project phase');
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'project');
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					console.log('Debug: Starting getMany operation for project phases');
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'project' });
					console.log('Debug: Created GetManyOperation instance');

					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					console.log('Debug: Built filters:', filters);

					const response = await getManyOp.execute({ filter: filters }, i);
					console.log('Debug: GetMany operation response:', response);

					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'project' });
					returnData.push(...results);
					break;
				}

				case 'count': {
					console.log('Debug: Starting count operation for project phases');
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
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i, 'project');
					returnData.push(response);
					break;
				}

				default:
					throw new Error(`Operation ${operation} is not supported`);
			}
		} catch (error) {
			console.error('Debug: Operation error:', error);
			if (this.continueOnFail()) {
				returnData.push({ json: { error: error.message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
