import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity, IFilterCondition } from '../../types';
import {
	GetManyOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { FilterOperators } from '../../constants/filters';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { autotaskApiRequest } from '../../helpers/http';

const ENTITY_TYPE = 'TicketHistory';

/**
 * Validates that the filter only contains a single ticketID equals condition
 * @param filter - The filter to validate
 * @throws Error if the filter is invalid
 */
function validateTicketHistoryFilter(filter: IFilterCondition[]): void {
	// Check if filter has exactly one condition
	if (filter.length !== 1) {
		throw new Error(
			ERROR_TEMPLATES.validation
				.replace('{type}', 'ValidationError')
				.replace('{entity}', ENTITY_TYPE)
				.replace('{details}', 'TicketHistory queries must have exactly one filter condition (ticketID equals)'),
		);
	}

	const condition = filter[0];

	// Check if the condition is for ticketID field
	if (condition.field !== 'ticketID') {
		throw new Error(
			ERROR_TEMPLATES.validation
				.replace('{type}', 'ValidationError')
				.replace('{entity}', ENTITY_TYPE)
				.replace('{details}', `TicketHistory queries must filter by ticketID field only, got ${condition.field}`),
		);
	}

	// Check if the operator is equals
	if (condition.op !== FilterOperators.eq) {
		throw new Error(
			ERROR_TEMPLATES.validation
				.replace('{type}', 'ValidationError')
				.replace('{entity}', ENTITY_TYPE)
				.replace('{details}', `TicketHistory queries must use equals operator only, got ${condition.op}`),
		);
	}
}

export async function executeTicketHistoryOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get': {
					// For TicketHistory, we can't query directly by ID (not supported by API)
					// Instead, we'll query by ticketID and then filter the results by ID
					const historyId = this.getNodeParameter('id', i) as string;
					const ticketID = this.getNodeParameter('ticketID', i) as string;

					// Create a filter for ticketID
					const filter: IFilterCondition[] = [
						{
							field: 'ticketID',
							op: FilterOperators.eq,
							value: ticketID,
						},
					];

					// Validate the filter
					validateTicketHistoryFilter(filter);

					// Use the GetManyOperation to query by ticketID
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getManyOp.execute({ filter }, i);

					// Find the specific history record with the matching ID
					const historyRecord = response.find(record => String(record.id) === historyId);

					if (!historyRecord) {
						throw new Error(
							ERROR_TEMPLATES.notFound
								.replace('{type}', 'NotFoundError')
								.replace('{entity}', ENTITY_TYPE)
								.replace('{details}', `TicketHistory record with ID ${historyId} not found for ticket ${ticketID}`)
						);
					}

					returnData.push({ json: historyRecord });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);

					// For TicketHistory, we only allow filtering by ticketID
					const ticketID = this.getNodeParameter('ticketID', i) as string;
					const filter: IFilterCondition[] = [
						{
							field: 'ticketID',
							op: FilterOperators.eq,
							value: ticketID,
						},
					];

					// Validate the filter
					validateTicketHistoryFilter(filter);

					const response = await getManyOp.execute({ filter }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'count': {
					// For TicketHistory, we need to manually handle the count operation
					// since it requires a specific filter that's not built from the resource mapper
					const ticketID = this.getNodeParameter('ticketID', i) as string;
					const filter: IFilterCondition[] = [
						{
							field: 'ticketID',
							op: FilterOperators.eq,
							value: ticketID,
						},
					];

					// Validate the filter
					validateTicketHistoryFilter(filter);

					// Build the endpoint URL
					const endpoint = `/V1.0/${ENTITY_TYPE}/query/count`;

					// Make the API request
					const response = await autotaskApiRequest.call(
						this,
						'POST',
						endpoint,
						{ filter }
					);

					// Extract the count from the response
					const count = (response as { queryCount: number }).queryCount;

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
					throw new Error(`Operation ${operation} is not supported for ${ENTITY_TYPE}`);
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
