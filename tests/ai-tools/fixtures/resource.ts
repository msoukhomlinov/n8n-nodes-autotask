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

export function getResourceTestCases(fx: SharedFixtures): TestCase[] {
  return [
    // ---- Metadata -------------------------------------------------------
    ...commonMetadataCases({ describeOpTarget: 'whoAmI' }),

    // ---- whoAmI ---------------------------------------------------------
    {
      name: 'whoAmI',
      args: { operation: 'whoAmI' },
      assert(r) {
        assertItemShape(r);
        assertCommonSuccessFields(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, 'whoAmI record must have a numeric id').toBeTypeOf('number');
        expect(
          record.email ?? record.firstName ?? record.lastName,
          'whoAmI record must have email or name field'
        ).toBeTruthy();
      },
    },

    // ---- getMany --------------------------------------------------------
    ...listOperationCases(fx),

    // ---- get ------------------------------------------------------------
    {
      name: 'get valid id',
      args: { operation: 'get', id: fx.currentResourceId ?? fx.bogusId },
      requires: [requires.whoAmI],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match currentResourceId (${fx.currentResourceId})`).toBe(fx.currentResourceId);
      },
    },
    {
      name: 'get invalid id',
      args: { operation: 'get', id: fx.bogusId },
      assert(r) {
        assertErrorShape(r, 'ENTITY_NOT_FOUND');
      },
    },

    // ---- error routing --------------------------------------------------
    ...commonErrorCases(),
  ];
}
