export type TicketType = 'Service Request' | 'Incident' | 'Problem' | 'Change Request' | 'Alert' | 'Unknown';

export const TICKET_TYPE_NUMERIC: Record<number, TicketType> = {
    1: 'Service Request',
    2: 'Incident',
    3: 'Problem',
    4: 'Change Request',
    5: 'Alert',
};

export type TypeDetectionMethod = 'label' | 'numericField' | 'fallback';

export interface TicketTypeDetection {
    type: TicketType;
    detectedBy: TypeDetectionMethod;
}

export function detectTicketTypeDetailed(ticket: Record<string, unknown>): TicketTypeDetection {
    const label = String(ticket.ticketType_label ?? '').toLowerCase();
    if (label.includes('change request')) return { type: 'Change Request', detectedBy: 'label' };
    if (label.includes('incident')) return { type: 'Incident', detectedBy: 'label' };
    if (label.includes('problem')) return { type: 'Problem', detectedBy: 'label' };
    if (label.includes('service request')) return { type: 'Service Request', detectedBy: 'label' };
    if (label.includes('alert')) return { type: 'Alert', detectedBy: 'label' };
    const numType = Number(ticket.ticketType);
    if (TICKET_TYPE_NUMERIC[numType]) return { type: TICKET_TYPE_NUMERIC[numType], detectedBy: 'numericField' };
    return { type: 'Unknown', detectedBy: 'fallback' };
}

export function detectTicketType(ticket: Record<string, unknown>): TicketType {
    return detectTicketTypeDetailed(ticket).type;
}
