import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { CreateOperation } from '../../operations/base';

const ENTITY_TYPE = 'contractServiceBundleAdjustment';

// Interface for the fields we need to validate
interface ContractServiceBundleAdjustmentFields {
	contractServiceBundleID?: string | number;
	contractID?: string | number;
	serviceBundleID?: string | number;
	[key: string]: unknown;
}

export async function executeContractServiceBundleAdjustmentOperation(
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
					console.log('Debug: Starting create operation for Contract Service Bundle Adjustment');

					// Create operation instance
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					console.log('Debug: Created operation instance');

					// Get the mapped fields
					const fields = this.getNodeParameter('fieldsToMap', i, {}) as { mappingMode: string; value: object };
					console.log('Debug: Field mapping:', fields);

					// Extract field values for validation
					let fieldValues: ContractServiceBundleAdjustmentFields = {};
					if (fields.mappingMode === 'defineBelow' && fields.value) {
						fieldValues = fields.value as ContractServiceBundleAdjustmentFields;
					} else if (fields.mappingMode === 'autoMapInputData') {
						// Auto-mapped fields are in the input data
						fieldValues = items[i].json as ContractServiceBundleAdjustmentFields;
					}

					// Validate required fields based on conditions
					const contractServiceBundleID = fieldValues.contractServiceBundleID;
					const contractID = fieldValues.contractID;
					const serviceBundleID = fieldValues.serviceBundleID;

					if (!contractServiceBundleID && (!contractID || !serviceBundleID)) {
						throw new Error('Either Contract Service Bundle ID OR both Contract ID and Service Bundle ID must be provided');
					}

					// Execute the operation
					const response = await createOp.execute(i);
					console.log('Debug: Operation response:', response);
					returnData.push({ json: response });
					break;
				}
				default:
					throw new Error(`Operation ${operation} is not supported for Contract Service Bundle Adjustments`);
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
