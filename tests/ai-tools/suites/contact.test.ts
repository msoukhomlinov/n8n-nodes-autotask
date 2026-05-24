import { registerResourceSuite } from './_runner';
import { getContactTestCases } from '../fixtures/contact';
registerResourceSuite({ resource: 'contact', toolName: 'autotask_contact', cases: getContactTestCases });
