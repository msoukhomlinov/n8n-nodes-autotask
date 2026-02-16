import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
    CountOperation,
    CreateOperation,
    DeleteOperation,
    GetManyOperation,
    GetOperation,
} from '../../operations/base';

const ENTITY_TYPE = 'ticketChangeRequestApproval';

function getTicketId(context: IExecuteFunctions, itemIndex: number): string | number | undefined {
    const ticketID = context.getNodeParameter('ticketID', itemIndex, '') as string;
    const normalizedId = String(ticketID).trim();
    return normalizedId.length > 0 ? normalizedId : undefined;
}

async function executeCreateWithChildTicket(
    context: IExecuteFunctions,
    itemIndex: number,
    ticketID: string | number,
): Promise<IAutotaskEntity> {
    const originalGetNodeParameter = context.getNodeParameter;

    context.getNodeParameter = ((name, index, fallbackValue, options) => {
        if (name !== 'fieldsToMap') {
            return originalGetNodeParameter.call(context, name, index, fallbackValue, options);
        }

        const existing = originalGetNodeParameter.call(
            context,
            'fieldsToMap',
            index,
            { mappingMode: 'defineBelow', value: {} },
            options,
        ) as { mappingMode?: string; value?: Record<string, unknown> };

        return {
            mappingMode: existing?.mappingMode ?? 'defineBelow',
            value: {
                ...(existing?.value ?? {}),
                ticketID,
            },
        };
    }) as typeof context.getNodeParameter;

    try {
        const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, context);
        return await createOp.execute(itemIndex);
    } finally {
        context.getNodeParameter = originalGetNodeParameter;
    }
}

export async function executeTicketChangeRequestApprovalOperation(
    this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
        try {
            switch (operation) {
                case 'create': {
                    const ticketID = getTicketId(this, i);
                    if (ticketID === undefined) {
                        throw new Error('Create requires Ticket ID and uses the ticket child endpoint when provided');
                    }
                    const response = await executeCreateWithChildTicket(this, i, ticketID);
                    returnData.push({ json: response });
                    break;
                }

                case 'delete': {
                    const ticketID = getTicketId(this, i);
                    if (ticketID === undefined) {
                        throw new Error('Delete requires Ticket ID and uses the ticket child endpoint when provided');
                    }
                    const deleteOp = new DeleteOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                    const response = await deleteOp.execute(i);
                    returnData.push({ json: (response ?? { success: true }) as IDataObject });
                    break;
                }

                case 'get': {
                    const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this, 'ticket');
                    const response = await getOp.execute(i);
                    returnData.push({ json: response });
                    break;
                }

                case 'getMany': {
                    const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'ticket' });
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

                default:
                    throw new Error(`Operation ${operation} is not supported`);
            }
        } catch (error) {
            if (this.continueOnFail()) {
                returnData.push({ json: { error: (error as Error).message } });
                continue;
            }
            throw error;
        }
    }

    return [returnData];
}
