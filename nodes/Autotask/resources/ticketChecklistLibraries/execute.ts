import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'ticketChecklistLibrary';

export async function executeTicketChecklistLibraryOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					console.log('Debug: Starting create checklist library operation');
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created operation instance');

					const response = await createOp.execute(i);
					console.log('Debug: Operation response:', response);
					returnData.push({ json: response });
					break;
				}
				default:
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported!`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ error: error.message, json: {} });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
