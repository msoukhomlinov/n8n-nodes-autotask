import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { searchCompaniesByDomain } from '../../helpers/company-domain-search';

const ENTITY_TYPE = 'company';

export async function executeCompanyOperation(
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

				case 'update': {
					const companyId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, companyId);
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

				case 'searchByDomain': {
					const domain = this.getNodeParameter('domain', i) as string;
					const domainOperator = this.getNodeParameter('domainOperator', i, 'contains') as string;
					const searchContactEmails = this.getNodeParameter('searchContactEmails', i, true) as boolean;
					const limit = this.getNodeParameter('limit', i, 25) as number;
					const response = await searchCompaniesByDomain(this, {
						domain,
						domainOperator,
						searchContactEmails,
						limit,
						itemIndex: i,
					});
					returnData.push({ json: response });
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
