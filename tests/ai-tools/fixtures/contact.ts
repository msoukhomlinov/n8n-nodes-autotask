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
import type { TestCase } from '../context/types';

export function getContactTestCases(fx: SharedFixtures): TestCase[] {
  return [
    // ---- Metadata -------------------------------------------------------
    ...commonMetadataCases({ describeOpTarget: 'getMany' }),

    // ---- getMany --------------------------------------------------------
    {
      name: 'getMany by company',
      args: {
        operation: 'getMany',
        filter_field: 'companyID',
        filter_op: 'eq',
        filter_value: fx.companyId ?? fx.bogusId,
      },
      requires: [requires.companyId],
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
    {
      name: 'getMany no results',
      args: {
        operation: 'getMany',
        filter_field: 'id',
        filter_op: 'eq',
        filter_value: fx.bogusId,
      },
      assert(r) {
        assertErrorShape(r, 'NO_RESULTS_FOUND');
      },
    },
    {
      name: 'getMany filtersJson',
      args: {
        operation: 'getMany',
        filtersJson: '[{"field":"id","op":"gt","value":0}]',
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r);
        } else {
          assertListShape(r);
        }
      },
    },

    // ---- get ------------------------------------------------------------
    {
      name: 'get valid id',
      args: { operation: 'get', id: fx.contactId ?? fx.bogusId },
      requires: [requires.contactId],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match contactId (${fx.contactId})`).toBe(fx.contactId);
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
