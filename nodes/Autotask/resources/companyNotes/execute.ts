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
import {
	isInactiveContactError,
	createWithTemporaryContactActivation,
	updateWithTemporaryContactActivation,
} from '../../helpers/companyNoteInactiveContact';

const ENTITY_TYPE = 'companyNote';

export async function executeCompanyNoteOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					try {
						const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
						const response = await createOp.execute(i);
						returnData.push({ json: response });
					} catch (createError) {
						if (isInactiveContactError(createError)) {
							const response = await createWithTemporaryContactActivation(this, i, createError as Error);
							returnData.push({ json: response });
						} else {
							throw createError;
						}
					}
					break;
				}

				case 'update': {
					const entityId = this.getNodeParameter('id', i) as string;
					try {
						const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
						const response = await updateOp.execute(i, entityId);
						returnData.push({ json: response });
					} catch (updateError) {
						if (isInactiveContactError(updateError)) {
							const response = await updateWithTemporaryContactActivation(this, i, entityId, updateError as Error);
							returnData.push({ json: response });
						} else {
							throw updateError;
						}
					}
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'company');
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'company' });
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i, { parentType: 'company' });
					returnData.push(...results);
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

				case 'getEntityInfo':
				case 'getFieldInfo': {
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i, 'company');
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
