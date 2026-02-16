import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { CreateOperation } from '../../operations/base';

const ENTITY_TYPE = 'contractServiceAdjustment';

// Interface for the fields we need to validate
interface ContractServiceAdjustmentFields {
	contractServiceID?: string | number;
	contractID?: string | number;
	serviceID?: string | number;
	[key: string]: unknown;
}

export async function executeContractServiceAdjustmentOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					// Log debugging info
					console.log('Debug: Starting create operation for Contract Service Adjustment');

					// Create operation instance
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created operation instance');

					// Get the mapped fields
					const fields = this.getNodeParameter('fieldsToMap', i, {}) as { mappingMode: string; value: object };
					console.log('Debug: Field mapping:', fields);

					// Extract field values for validation
					let fieldValues: ContractServiceAdjustmentFields = {};
					if (fields.mappingMode === 'defineBelow' && fields.value) {
						fieldValues = fields.value as ContractServiceAdjustmentFields;
					} else if (fields.mappingMode === 'autoMapInputData') {
						// Auto-mapped fields are in the input data
						fieldValues = items[i].json as ContractServiceAdjustmentFields;
					}

					// Validate required fields based on conditions
					const contractServiceID = fieldValues.contractServiceID;
					const contractID = fieldValues.contractID;
					const serviceID = fieldValues.serviceID;

					if (!contractServiceID && (!contractID || !serviceID)) {
						throw new Error('Either Contract Service ID OR both Contract ID and Service ID must be provided');
					}

					// Execute the operation
					const response = await createOp.execute(i);
					console.log('Debug: Operation response:', response);
					returnData.push({ json: response });
					break;
				}
				default:
					throw new Error(`Operation ${operation} is not supported for Contract Service Adjustments`);
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
