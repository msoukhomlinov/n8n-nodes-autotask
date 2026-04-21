import { registerResourceSuite } from './_runner';
import { getResourceTestCases } from '../fixtures/resource';
registerResourceSuite({ resource: 'resource', toolName: 'autotask_resource', cases: getResourceTestCases });
