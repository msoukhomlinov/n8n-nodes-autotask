import { expect } from 'vitest';
import {
  assertCommonSuccessFields,
  assertErrorShape,
  assertItemShape,
  assertListShape,
  assertPaginationConsistent,
} from '../assertions/response-shape';
import type { SharedFixtures } from '../context/shared-fixtures';
import { requires } from '../context/shared-fixtures';
import { commonMetadataCases, commonErrorCases } from './_common';
import { listOperationCases } from './_list';
import type { TestCase } from '../context/types';

export function getCompanyTestCases(fx: SharedFixtures): TestCase[] {
  return [
    // ---- Metadata -------------------------------------------------------
    ...commonMetadataCases({ describeOpTarget: 'getMany' }),

    // ---- getMany --------------------------------------------------------
    ...listOperationCases(fx),
    {
      name: 'getMany by companyName label',
      args: {
        operation: 'getMany',
        filter_field: 'companyName',
        filter_op: 'eq',
        filter_value: fx.companyName ?? '',
      },
      requires: [requires.companyName],
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          assertPaginationConsistent(r);
          assertCommonSuccessFields(r);
        }
      },
    },

    // ---- get ------------------------------------------------------------
    {
      name: 'get valid id',
      args: { operation: 'get', id: fx.companyId ?? fx.bogusId },
      requires: [requires.companyId],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match companyId (${fx.companyId})`).toBe(fx.companyId);
      },
    },
    {
      name: 'get invalid id',
      args: { operation: 'get', id: fx.bogusId },
      assert(r) {
        // Autotask sandbox returns PERMISSION_DENIED for non-existent IDs
        const acceptedTypes = ['ENTITY_NOT_FOUND', 'PERMISSION_DENIED'];
        expect(acceptedTypes.includes(r.errorType as string), `errorType must be ENTITY_NOT_FOUND or PERMISSION_DENIED, got: ${r.errorType}`).toBe(true);
        expect(r.error, '"error" must be true').toBe(true);
      },
    },

    // ---- error routing --------------------------------------------------
    ...commonErrorCases(),
  ];
}
