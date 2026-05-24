import { registerResourceSuite } from './_runner';
import { getTicketTestCases } from '../fixtures/ticket';
registerResourceSuite({ resource: 'ticket', toolName: 'autotask_ticket', cases: getTicketTestCases });
