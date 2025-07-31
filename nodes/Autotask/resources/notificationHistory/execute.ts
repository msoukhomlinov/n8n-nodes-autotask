import { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { IAutotaskEntity } from '../../types';
import {
  GetOperation,
  GetManyOperation,
  CountOperation
} from '../../operations/base';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';

const ENTITY_TYPE = 'notificationHistory';

export async function executeNotificationHistoryOperation(
  this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const returnData: INodeExecutionData[] = [];
  const operation = this.getNodeParameter('operation', 0) as string;

  for (let i = 0; i < items.length; i++) {
    try {
      switch (operation) {
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
        case 'getManyAdvanced': {
          const response = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
          returnData.push(...response);
          break;
        }
        case 'getEntityInfo':
        case 'getFieldInfo': {
          const response = await executeEntityInfoOperations(
            ENTITY_TYPE,
            operation,
            this,
            i
          );
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
