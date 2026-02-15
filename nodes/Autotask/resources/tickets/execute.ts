import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
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
import { autotaskApiRequest } from '../../helpers/http';
import { FilterOperators } from '../../constants/filters';
import { processOutputMode } from '../../helpers/output-mode';
import { filterEntityBySelectedColumns } from '../../operations/common/select-columns/filter-entity';

const ENTITY_TYPE = 'ticket';
const DEFAULT_SLA_TICKET_FIELDS = ['id', 'ticketNumber', 'title', 'status', 'companyID'];

type TicketIdentifierType = 'id' | 'ticketNumber';

function roundHours(value: number): number {
    return Math.round(value * 100) / 100;
}

function parseDateValue(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function getStringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function getNumberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return roundHours(value);
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return roundHours(parsed);
        }
    }

    return null;
}

function getBooleanValue(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function computeMilestoneStatus(
    dueDateTime: string | null,
    actualDateTime: string | null,
    elapsedHours: number | null,
    isMet: boolean | null,
    now: Date,
): { status: string; wallClockRemainingHours: number | null } {
    const dueDate = parseDateValue(dueDateTime);
    const actualDate = parseDateValue(actualDateTime);

    if (isMet === true) {
        return { status: 'Met', wallClockRemainingHours: null };
    }

    if (isMet === false) {
        return { status: 'Breached', wallClockRemainingHours: null };
    }

    if (dueDate && actualDate) {
        return {
            status: actualDate.getTime() <= dueDate.getTime() ? 'Met' : 'Breached',
            wallClockRemainingHours: null,
        };
    }

    if (!dueDate) {
        return { status: 'Pending', wallClockRemainingHours: null };
    }

    const remaining = roundHours((dueDate.getTime() - now.getTime()) / 3600000);
    if (remaining < 0) {
        return { status: 'Breached', wallClockRemainingHours: remaining };
    }

    if (elapsedHours !== null && elapsedHours > 0) {
        const total = elapsedHours + remaining;
        if (total > 0 && remaining / total < 0.25) {
            return { status: 'At Risk', wallClockRemainingHours: remaining };
        }
        return { status: 'On Track', wallClockRemainingHours: remaining };
    }

    return {
        status: remaining <= 1 ? 'At Risk' : 'On Track',
        wallClockRemainingHours: remaining,
    };
}

async function resolveTicketIdByTicketNumber(
    context: IExecuteFunctions,
    itemIndex: number,
): Promise<string> {
    const ticketNumber = (context.getNodeParameter('ticketNumber', itemIndex) as string).trim();
    if (!ticketNumber) {
        throw new Error('Ticket Number is required for SLA health checks');
    }

    const queryResponse = await autotaskApiRequest.call(
        context,
        'POST',
        'Tickets/query',
        {
            filter: [{ field: 'ticketNumber', op: FilterOperators.eq, value: ticketNumber }],
            IncludeFields: ['id', 'ticketNumber'],
            MaxRecords: 2,
        } as unknown as IDataObject,
    ) as { items?: Array<{ id?: string | number }> };

    const matches = Array.isArray(queryResponse.items) ? queryResponse.items : [];
    if (matches.length === 0) {
        throw new Error(`No ticket found for ticket number "${ticketNumber}"`);
    }

    if (matches.length > 1) {
        throw new Error(`Multiple tickets found for ticket number "${ticketNumber}". Please use Ticket ID.`);
    }

    const ticketId = matches[0]?.id;
    if (ticketId === undefined || ticketId === null || ticketId === '') {
        throw new Error(`Ticket lookup for "${ticketNumber}" did not return a valid ticket ID`);
    }

    return String(ticketId);
}

async function executeSlaHealthCheck(
    context: IExecuteFunctions,
    itemIndex: number,
): Promise<INodeExecutionData> {
    const getSelectedSlaTicketFields = (): string[] => {
        try {
            const rawValue = context.getNodeParameter('slaTicketFields', itemIndex, []) as string[] | string;
            const values = Array.isArray(rawValue)
                ? rawValue.filter((field): field is string => typeof field === 'string' && field.trim() !== '')
                : typeof rawValue === 'string' && rawValue.trim() !== ''
                    ? rawValue.split(',').map((field) => field.trim()).filter(Boolean)
                    : [];
            return values.length > 0 ? values : [...DEFAULT_SLA_TICKET_FIELDS];
        } catch {
            return [...DEFAULT_SLA_TICKET_FIELDS];
        }
    };

    const isReferenceLabelEnrichmentEnabled = (): boolean => {
        try {
            return Boolean(context.getNodeParameter('addReferenceLabels', itemIndex, false));
        } catch {
            return false;
        }
    };

    const ensureCompanyLabelForSlaTicket = async (ticket: IAutotaskEntity): Promise<void> => {
        if (!isReferenceLabelEnrichmentEnabled()) {
            return;
        }

        const currentLabel = getStringValue(ticket.companyID_label);
        if (currentLabel !== null) {
            return;
        }

        const companyId = ticket.companyID;
        if (companyId === undefined || companyId === null || companyId === '') {
            return;
        }

        try {
            const companyResponse = await autotaskApiRequest.call(
                context,
                'GET',
                `Companies/${companyId}`,
            ) as { item?: IAutotaskEntity };
            const companyName = getStringValue(companyResponse.item?.companyName);
            if (companyName !== null) {
                ticket.companyID_label = companyName;
            }
        } catch {
            // Do not fail SLA checks because company label enrichment failed.
        }
    };

    const identifierType = context.getNodeParameter(
        'ticketIdentifierType',
        itemIndex,
        'id',
    ) as TicketIdentifierType;

    const ticketId = identifierType === 'ticketNumber'
        ? await resolveTicketIdByTicketNumber(context, itemIndex)
        : String(context.getNodeParameter('id', itemIndex));

    if (!ticketId || ticketId.trim() === '') {
        throw new Error('Ticket ID is required for SLA health checks');
    }

    const ticketResponse = await autotaskApiRequest.call(
        context,
        'GET',
        `Tickets/${ticketId}`,
    ) as { item?: IAutotaskEntity };

    const rawTicket = ticketResponse.item;
    if (!rawTicket || typeof rawTicket !== 'object') {
        throw new Error(`Ticket with ID ${ticketId} was not found`);
    }

    const ticket = await processOutputMode(rawTicket, ENTITY_TYPE, context, itemIndex) as IAutotaskEntity;
    await ensureCompanyLabelForSlaTicket(ticket);
    const selectedSlaTicketFields = getSelectedSlaTicketFields();
    const filteredTicket = filterEntityBySelectedColumns(ticket, selectedSlaTicketFields) as IAutotaskEntity;

    const slaResultsResponse = await autotaskApiRequest.call(
        context,
        'POST',
        'ServiceLevelAgreementResults/query',
        {
            filter: [{ field: 'ticketID', op: FilterOperators.eq, value: Number(ticketId) }],
            MaxRecords: 50,
        } as unknown as IDataObject,
    ) as { items?: IAutotaskEntity[] };

    const rawSlaResults = Array.isArray(slaResultsResponse.items) ? slaResultsResponse.items : [];
    const enrichedSlaResults = await processOutputMode(
        rawSlaResults,
        'serviceLevelAgreementResults',
        context,
        itemIndex,
    ) as IAutotaskEntity[];

    const sortedSlaResults = [...enrichedSlaResults].sort((a, b) => {
        const idA = Number(a.id ?? 0);
        const idB = Number(b.id ?? 0);
        return idB - idA;
    });

    const primarySlaResult = sortedSlaResults[0] ?? null;
    const hasSla = ticket.serviceLevelAgreementID !== undefined && ticket.serviceLevelAgreementID !== null;
    const now = new Date();

    const pausedNextEventHours = getNumberValue(ticket.serviceLevelAgreementPausedNextEventHours);
    const isPaused = pausedNextEventHours !== null && pausedNextEventHours > 0;
    const overallMet = getBooleanValue(ticket.serviceLevelAgreementHasBeenMet);

    const buildMilestone = (
        dueField: string,
        actualField: string,
        elapsedField: string,
        metField: string,
    ): IDataObject => {
        const dueDateTime = getStringValue(ticket[dueField]);
        const actualDateTime = getStringValue(ticket[actualField]);
        const elapsedHours = getNumberValue(primarySlaResult?.[elapsedField]);
        const met = getBooleanValue(primarySlaResult?.[metField]);

        if (!hasSla) {
            return {
                dueDateTime,
                actualDateTime,
                elapsedHours,
                met,
                status: 'No SLA',
                wallClockRemainingHours: null,
            };
        }

        const computed = computeMilestoneStatus(dueDateTime, actualDateTime, elapsedHours, met, now);

        return {
            dueDateTime,
            actualDateTime,
            elapsedHours,
            met,
            status: computed.status,
            wallClockRemainingHours: computed.wallClockRemainingHours,
        };
    };

    const response: IDataObject = {
        ticket: filteredTicket as unknown as IDataObject,
        sla: {
            id: ticket.serviceLevelAgreementID ?? null,
            id_label: ticket.serviceLevelAgreementID_label ?? null,
            name: getStringValue(primarySlaResult?.serviceLevelAgreementName) ?? ticket.serviceLevelAgreementID_label ?? null,
            overallMet,
            isPaused,
            pausedNextEventHours,
        },
        firstResponse: buildMilestone(
            'firstResponseDueDateTime',
            'firstResponseDateTime',
            'firstResponseElapsedHours',
            'isFirstResponseMet',
        ),
        resolutionPlan: buildMilestone(
            'resolutionPlanDueDateTime',
            'resolutionPlanDateTime',
            'resolutionPlanElapsedHours',
            'isResolutionPlanMet',
        ),
        resolution: buildMilestone(
            'resolvedDueDateTime',
            'resolvedDateTime',
            'resolutionElapsedHours',
            'isResolutionMet',
        ),
        _meta: {
            timeUnit: 'hours',
            timeUnitPrecision: 2,
            wallClockDisclaimer: 'wallClockRemainingHours is calendar time, not SLA business hours',
            source: 'ticket.slaHealthCheck',
            generatedAt: now.toISOString(),
        },
    };

    return { json: response };
}

export async function executeTicketOperation(
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
                    const entityId = this.getNodeParameter('id', i) as string;
                    const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                    const response = await updateOp.execute(i, entityId);
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
                    console.log('Debug: Built filters:', filters);
                    const response = await getManyOp.execute({ filter: filters }, i);
                    returnData.push(...getManyOp.processReturnData(response));
                    break;
                }

                case 'getManyAdvanced': {
                    const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
                    returnData.push(...results);
                    break;
                }

                case 'slaHealthCheck': {
                    const response = await executeSlaHealthCheck(this, i);
                    returnData.push(response);
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
