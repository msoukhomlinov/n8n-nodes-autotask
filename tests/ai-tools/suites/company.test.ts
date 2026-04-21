import { registerResourceSuite } from './_runner';
import { getCompanyTestCases } from '../fixtures/company';

registerResourceSuite({ resource: 'company', toolName: 'autotask_company', cases: getCompanyTestCases });
