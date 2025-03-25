import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type {
	IAutotaskEntity,
	IAutotaskCredentials,
	IAutotaskQueryInput
} from '../../types';
import {
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';
import { getSelectedColumns, prepareIncludeFields } from '../../operations/common/select-columns';

const ENTITY_TYPE = 'resource';

export async function executeResourceOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'update': {
					const resourceId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, resourceId);
					returnData.push({ json: response });
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const filters = getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'whoAmI': {
					try {
						// Get credentials
						const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
						const email = credentials.Username as string;

						if (!email) {
							throw new Error('Username not found in credentials');
						}

						// Extract username (part before @)
						const username = email.includes('@') ? email.split('@')[0] : email;

						// Create filter for username
						const filter = [
							{
								op: 'eq',
								field: 'userName',
								value: username,
							},
						];

						// Execute query
						const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);

						// Handle include fields for server-side filtering if needed
						const selectedColumns = getSelectedColumns(this, i);
						const includeFields = prepareIncludeFields(selectedColumns);

						// Add includeFields to the query if columns are selected
						const queryParams: IAutotaskQueryInput<IAutotaskEntity> = {
							filter,
							...(includeFields ? { includeFields } : {})
						};

						const response = await getManyOp.execute(queryParams, i);

						// Process and return results
						returnData.push(...getManyOp.processReturnData(response));
					} catch (error) {
						if (this.continueOnFail()) {
							returnData.push({ json: { error: error.message } });
						} else {
							throw error;
						}
					}
					break;
				}

				case 'getManyAdvanced': {
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
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
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
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
