import type { McpTestClient } from '../mcp-client';
import type { EndpointConfig } from '../test-config';

export interface SharedFixtures {
  ticketId: number;
  ticketNumber: string | null;
  companyId: number | null;
  companyName: string | null;
  contactId: number | null;
  assignedResourceId: number | null;
  currentResourceId: number | null;
  currentResourceEmail: string | null;
  ticketNoteId: number | null;
  timeEntryId: number | null;
  isReadOnly: boolean;
  readonly bogusId: 999999999;
  endpoint: EndpointConfig;
  warnings: string[];
}

/**
 * Builds SharedFixtures for one endpoint. Never throws — errors are captured
 * in `warnings` and affected fields are set to null.
 *
 * Makes up to 4 API calls:
 *   1. autotask_ticket.get(TEST_TICKET_ID) — ticketNumber, companyId, contactId, assignedResourceId
 *   2. autotask_resource.whoAmI — currentResourceId, currentResourceEmail
 *   3. autotask_ticketNote.getMany (lazy — skipped when TEST_TICKET_NOTE_ID is set)
 *   4. autotask_timeEntry.getUnposted (lazy — skipped when TEST_TIME_ENTRY_ID is set)
 */
export async function buildSharedFixtures(
  client: McpTestClient,
  endpoint: EndpointConfig
): Promise<SharedFixtures> {
  const warnings: string[] = [];
  const ticketId = parseInt(process.env.TEST_TICKET_ID ?? '0', 10);

  const fx: SharedFixtures = {
    ticketId,
    ticketNumber: null,
    companyId: process.env.TEST_COMPANY_ID ? parseInt(process.env.TEST_COMPANY_ID, 10) : null,
    companyName: process.env.TEST_COMPANY_NAME ?? null,
    contactId: process.env.TEST_CONTACT_ID ? parseInt(process.env.TEST_CONTACT_ID, 10) : null,
    assignedResourceId: process.env.TEST_RESOURCE_ID ? parseInt(process.env.TEST_RESOURCE_ID, 10) : null,
    currentResourceId: null,
    currentResourceEmail: null,
    ticketNoteId: process.env.TEST_TICKET_NOTE_ID ? parseInt(process.env.TEST_TICKET_NOTE_ID, 10) : null,
    timeEntryId: process.env.TEST_TIME_ENTRY_ID ? parseInt(process.env.TEST_TIME_ENTRY_ID, 10) : null,
    isReadOnly: endpoint.isReadOnly,
    bogusId: 999999999 as const,
    endpoint,
    warnings,
  };

  if (ticketId <= 0) {
    warnings.push('TEST_TICKET_ID not set or 0 — most fixture IDs unavailable. Most cases will be skipped.');
    return fx;
  }

  // Call 1: ticket.get
  try {
    const result = await client.callTool('autotask_ticket', { operation: 'get', id: ticketId });
    if (!result.error) {
      const record = result.record as Record<string, unknown>;
      fx.ticketNumber = (record.ticketNumber as string) ?? null;
      if (fx.companyId == null) fx.companyId = (record.companyID as number) ?? null;
      if (fx.contactId == null) fx.contactId = (record.contactID as number) ?? null;
      if (fx.assignedResourceId == null) fx.assignedResourceId = (record.assignedResourceID as number) ?? null;
      if (!fx.ticketNumber) {
        warnings.push(`Ticket ${ticketId} has no ticketNumber — slaHealthCheck and summary cases will be skipped.`);
      }
    } else {
      warnings.push(`autotask_ticket.get(${ticketId}) error: ${result.summary}`);
    }
  } catch (err) {
    warnings.push(`autotask_ticket.get(${ticketId}) threw: ${err}`);
  }

  // Call 2: resource.whoAmI
  try {
    const result = await client.callTool('autotask_resource', { operation: 'whoAmI' });
    if (!result.error) {
      const record = result.record as Record<string, unknown>;
      fx.currentResourceId = (record.id as number) ?? null;
      fx.currentResourceEmail = (record.email as string) ?? null;
    } else {
      warnings.push(`autotask_resource.whoAmI error: ${result.summary}`);
    }
  } catch (err) {
    warnings.push(`autotask_resource.whoAmI threw: ${err}`);
  }

  // Call 3: ticketNote.getMany (lazy)
  if (fx.ticketNoteId == null) {
    try {
      const result = await client.callTool('autotask_ticketNote', {
        operation: 'getMany',
        filter_field: 'ticketID',
        filter_op: 'eq',
        filter_value: ticketId,
      });
      if (!result.error) {
        const records = result.records as Array<Record<string, unknown>>;
        fx.ticketNoteId = records.length > 0 ? (records[0].id as number) : null;
        if (fx.ticketNoteId == null) {
          warnings.push('No ticket notes on pivot ticket — ticketNoteId unavailable. Set TEST_TICKET_NOTE_ID to override.');
        }
      } else {
        warnings.push(`autotask_ticketNote.getMany error: ${result.summary}`);
      }
    } catch (err) {
      warnings.push(`autotask_ticketNote.getMany threw: ${err}`);
    }
  }

  // Call 4: timeEntry.getUnposted (lazy)
  if (fx.timeEntryId == null) {
    try {
      const result = await client.callTool('autotask_timeEntry', {
        operation: 'getUnposted',
        filter_field: 'ticketID',
        filter_op: 'eq',
        filter_value: ticketId,
      });
      if (!result.error) {
        const records = result.records as Array<Record<string, unknown>>;
        fx.timeEntryId = records.length > 0 ? (records[0].id as number) : null;
        if (fx.timeEntryId == null) {
          warnings.push('No unposted time entries on pivot ticket — timeEntryId unavailable. Set TEST_TIME_ENTRY_ID to override.');
        }
      } else {
        warnings.push(`autotask_timeEntry.getUnposted error: ${result.summary}`);
      }
    } catch (err) {
      warnings.push(`autotask_timeEntry.getUnposted threw: ${err}`);
    }
  }

  return fx;
}

/**
 * Returns a SharedFixtures stub with all IDs null/0 for describe-time test name registration.
 * bogusId is still the real value — test names must not embed runtime fixture values.
 */
export function dryRunStub(endpoint?: EndpointConfig): SharedFixtures {
  const stubEndpoint: EndpointConfig = endpoint ?? {
    name: 'stub',
    url: '',
    kind: 'baseline',
    isReadOnly: false,
  };
  return {
    ticketId: 0,
    ticketNumber: null,
    companyId: null,
    companyName: null,
    contactId: null,
    assignedResourceId: null,
    currentResourceId: null,
    currentResourceEmail: null,
    ticketNoteId: null,
    timeEntryId: null,
    isReadOnly: false,
    bogusId: 999999999 as const,
    endpoint: stubEndpoint,
    warnings: [],
  };
}

/** Prebuilt guard helpers. Pass one or more to `TestCase.requires`. */
export const requires = {
  ticketId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.ticketId > 0
      ? { ok: true }
      : { ok: false, reason: 'TEST_TICKET_ID not set or 0' },

  ticketNumber: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.ticketNumber != null
      ? { ok: true }
      : { ok: false, reason: 'ticketNumber not available on pivot ticket' },

  companyId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.companyId != null
      ? { ok: true }
      : { ok: false, reason: 'companyId not derived — ticket may have no company' },

  companyName: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.companyName != null
      ? { ok: true }
      : { ok: false, reason: 'TEST_COMPANY_NAME not set' },

  contactId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.contactId != null
      ? { ok: true }
      : { ok: false, reason: 'contactId not derived — ticket may have no contact' },

  assignedResourceId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.assignedResourceId != null
      ? { ok: true }
      : { ok: false, reason: 'assignedResourceId not derived from pivot ticket' },

  whoAmI: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.currentResourceId != null
      ? { ok: true }
      : { ok: false, reason: 'whoAmI call failed or returned no resource ID' },

  ticketNoteId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.ticketNoteId != null
      ? { ok: true }
      : { ok: false, reason: 'ticketNoteId not available — set TEST_TICKET_NOTE_ID or ensure pivot ticket has notes' },

  timeEntryId: (fx: SharedFixtures): { ok: true } | { ok: false; reason: string } =>
    fx.timeEntryId != null
      ? { ok: true }
      : { ok: false, reason: 'timeEntryId not available — set TEST_TIME_ENTRY_ID or ensure pivot ticket has unposted time entries' },
};
