import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
	DeleteOperation,
} from '../../operations/base';
import { createHolidayIfNotExists } from '../../helpers/holiday-creator';

const ENTITY_TYPE = 'holiday';

export async function executeHolidayOperation(
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
					returnData.push({ json: response as unknown as IDataObject });
					break;
				}

				case 'update': {
					const entityId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, entityId);
					returnData.push({ json: response as unknown as IDataObject });
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'holidaySet');
					const response = await getOp.execute(i);
					returnData.push({ json: response as unknown as IDataObject });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'holidaySet' });
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

				case 'delete': {
					const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await deleteOp.execute(i);
					returnData.push({ json: (response || { success: true }) as IDataObject });
					break;
				}

				case 'createIfNotExists': {
					const fieldsToMap = this.getNodeParameter('fieldsToMap', i, {}) as { value?: Record<string, unknown> };
					const createFields: Record<string, unknown> = {};
					if (fieldsToMap?.value) {
						for (const [key, value] of Object.entries(fieldsToMap.value)) {
							if (value !== undefined && value !== null && value !== '') {
								createFields[key] = value;
							}
						}
					}
					const dedupFields = (this.getNodeParameter('dedupFields', i, []) as string[]);
					const errorOnDuplicate = this.getNodeParameter('errorOnDuplicate', i, false) as boolean;
					const updateFields = (this.getNodeParameter('updateFields', i, []) as string[]);
					const result = await createHolidayIfNotExists(this, i, {
						createFields,
						dedupFields,
						errorOnDuplicate,
						updateFields,
					});
					returnData.push({ json: result as unknown as IDataObject });
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
