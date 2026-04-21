import { registerResourceSuite } from './_runner';
import { getTimeEntryTestCases } from '../fixtures/timeEntry';

registerResourceSuite({ resource: 'timeEntry', toolName: 'autotask_timeEntry', cases: getTimeEntryTestCases });
