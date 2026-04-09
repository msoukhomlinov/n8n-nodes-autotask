import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import type { IAutotaskCredentials } from '../../types/base/auth';
import {
    CreateOperation,
    UpdateOperation,
    GetOperation,
    GetManyOperation,
    CountOperation,
} from '../../operations/base';
import { autotaskApiRequest } from '../../helpers/http';
import { FilterOperators } from '../../constants/filters';
import { processOutputMode } from '../../helpers/output-mode';
import { flattenUdfs } from '../../helpers/udf/flatten';
import { filterEntityBySelectedColumns } from '../../operations/common/select-columns/filter-entity';
import { applyChangeInfoAliases, buildAliasMap, shouldApplyAliases } from '../../helpers/change-info-aliases';
import { buildTicketSummary, fetchTicketChildCounts } from '../../helpers/ticket-summary';
import { detectTicketType } from '../../helpers/ticket-type';
import { roundSlaHours, computeMilestoneStatus } from '../../helpers/sla-milestone';

const ENTITY_TYPE = 'ticket';
const DEFAULT_SLA_TICKET_FIELDS = ['id', 'ticketNumber', 'title', 'status', 'companyID'];

type TicketIdentifierType = 'id' | 'ticketNumber';

function getStringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function getNumberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return roundSlaHours(value);
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return roundSlaHours(parsed);
        }
    }

    return null;
}

function getBooleanValue(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
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

async function executeTicketSummary(
    context: IExecuteFunctions,
    itemIndex: number,
): Promise<INodeExecutionData> {
    const identifierType = context.getNodeParameter(
        'ticketIdentifierType',
        itemIndex,
        'id',
    ) as 'id' | 'ticketNumber';

    const ticketId = identifierType === 'ticketNumber'
        ? await resolveTicketIdByTicketNumber(context, itemIndex)
        : String(context.getNodeParameter('id', itemIndex));

    if (!ticketId || ticketId.trim() === '') {
        throw new Error('Ticket ID is required for summary');
    }

    let includeRaw = false;
    try {
        includeRaw = Boolean(context.getNodeParameter('includeRaw', itemIndex, false));
    } catch {
        includeRaw = false;
    }

    let summaryTextLimit = 500;
    try {
        summaryTextLimit = Number(context.getNodeParameter('summaryTextLimit', itemIndex, 500));
        if (!Number.isFinite(summaryTextLimit) || summaryTextLimit < 0) {
            summaryTextLimit = 500;
        }
    } catch {
        summaryTextLimit = 500;
    }

    let includeChildCounts = false;
    try {
        includeChildCounts = Boolean(context.getNodeParameter('includeChildCounts', itemIndex, false));
    } catch {
        includeChildCounts = false;
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

    // Always enrich with reference and picklist labels, and flatten UDFs — no UI toggles needed.
    const enrichedTicket = await processOutputMode(rawTicket, ENTITY_TYPE, context, itemIndex, {
        addPicklistLabels: true,
        addReferenceLabels: true,
    }) as IAutotaskEntity;
    const ticket = flattenUdfs(enrichedTicket as unknown as IDataObject) as unknown as IAutotaskEntity;

    const credentials = await context.getCredentials('autotaskApi') as IAutotaskCredentials;
    const aliasMap = shouldApplyAliases(credentials) ? buildAliasMap(credentials) : null;

    const now = new Date();
    const ticketRecord = ticket as unknown as Record<string, unknown>;

    const earlyDetectedType = detectTicketType(ticketRecord);

    const childCountsInput = includeChildCounts
        ? (await fetchTicketChildCounts(context, ticketId, earlyDetectedType)).counts
        : {};

    const summaryResult = await buildTicketSummary(
        context,
        ticketRecord,
        childCountsInput,
        { includeRaw, summaryTextLimit, includeChildCounts },
        aliasMap,
        now,
    );

    return { json: summaryResult as unknown as IDataObject };
}

export async function executeTicketOperation(
    this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
    const aliasMap = shouldApplyAliases(credentials) ? buildAliasMap(credentials) : null;

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
                    if (aliasMap) applyChangeInfoAliases(response as Record<string, unknown>, aliasMap);
                    returnData.push({ json: response });
                    break;
                }

                case 'getMany': {
                    const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
                    const filters = await getManyOp.buildFiltersFromResourceMapper(i);
                    const response = await getManyOp.execute({ filter: filters }, i);
                    if (aliasMap) {
                        for (const item of response) {
                            applyChangeInfoAliases(item as Record<string, unknown>, aliasMap);
                        }
                    }
                    returnData.push(...getManyOp.processReturnData(response));
                    break;
                }

                case 'slaHealthCheck': {
                    const response = await executeSlaHealthCheck(this, i);
                    if (aliasMap && (response.json as Record<string, unknown>).ticket) {
                        applyChangeInfoAliases(
                            (response.json as Record<string, unknown>).ticket as Record<string, unknown>,
                            aliasMap,
                        );
                    }
                    returnData.push(response);
                    break;
                }

                case 'summary': {
                    const response = await executeTicketSummary(this, i);
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
