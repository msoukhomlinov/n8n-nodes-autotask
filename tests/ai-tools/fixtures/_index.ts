import type { FixtureFactory } from '../context/types';
import { getTicketTestCases } from './ticket';
import { getTicketNoteTestCases } from './ticketNote';
import { getTimeEntryTestCases } from './timeEntry';
import { getCompanyTestCases } from './company';
import { getContactTestCases } from './contact';
import { getResourceTestCases } from './resource';

export interface FixtureRegistration {
  /** MCP tool name called for all cases from this factory, e.g. 'autotask_ticket'. */
  toolName: string;
  factory: FixtureFactory;
}

export const allFixtureRegistrations: FixtureRegistration[] = [
  { toolName: 'autotask_ticket', factory: getTicketTestCases },
  { toolName: 'autotask_ticketNote', factory: getTicketNoteTestCases },
  { toolName: 'autotask_timeEntry', factory: getTimeEntryTestCases },
  { toolName: 'autotask_company', factory: getCompanyTestCases },
  { toolName: 'autotask_contact', factory: getContactTestCases },
  { toolName: 'autotask_resource', factory: getResourceTestCases },
];
