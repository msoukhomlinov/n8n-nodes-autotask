import { registerResourceSuite } from './_runner';
import { getTicketNoteTestCases } from '../fixtures/ticketNote';

registerResourceSuite({ resource: 'ticketNote', toolName: 'autotask_ticketNote', cases: getTicketNoteTestCases });
