import { expect } from 'vitest';
import {
  assertCommonSuccessFields,
  assertCompoundShape,
  assertErrorShape,
  assertItemShape,
  assertListShape,
  assertPaginationConsistent,
  assertIdBelongsToParent,
} from '../assertions/response-shape';
import type { SharedFixtures } from '../context/shared-fixtures';
import { requires } from '../context/shared-fixtures';
import { commonMetadataCases, commonErrorCases } from './_common';
import type { TestCase } from '../context/types';

export function getTimeEntryTestCases(fx: SharedFixtures): TestCase[] {
  const resourceId = fx.currentResourceId ?? fx.assignedResourceId ?? 0;

  return [
    // ---- Metadata -------------------------------------------------------
    ...commonMetadataCases({ describeOpTarget: 'getUnposted' }),

    // ---- getUnposted ----------------------------------------------------
    {
      name: 'getUnposted by ticket',
      args: {
        operation: 'getUnposted',
        filter_field: 'ticketID',
        filter_op: 'eq',
        filter_value: fx.ticketId,
      },
      requires: [requires.ticketId],
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
      args: { operation: 'get', id: fx.timeEntryId ?? fx.bogusId },
      requires: [requires.timeEntryId],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match timeEntryId (${fx.timeEntryId})`).toBe(fx.timeEntryId);
        assertIdBelongsToParent(r, 'ticketID', fx.ticketId);
      },
    },
    {
      name: 'get invalid id',
      args: { operation: 'get', id: fx.bogusId },
      assert(r) {
        assertErrorShape(r, 'ENTITY_NOT_FOUND');
      },
    },

    // ---- write (createIfNotExists) --------------------------------------
    {
      name: 'createIfNotExists on pivot ticket',
      args: {
        operation: 'createIfNotExists',
        resourceID: resourceId,
        ticketID: fx.ticketId,
        hoursWorked: 0.25,
        dateWorked: new Date().toISOString().split('T')[0],
        dedupFields: ['resourceID', 'ticketID', 'dateWorked'],
        errorOnDuplicate: false,
      },
      requires: [
        requires.ticketId,
        (fx) => (fx.currentResourceId != null || fx.assignedResourceId != null)
          ? { ok: true }
          : { ok: false, reason: 'no resourceId available (currentResourceId and assignedResourceId both null)' },
      ],
      isWrite: true,
      assert(r) {
        assertCompoundShape(r);
        assertCommonSuccessFields(r);
      },
    },

    // ---- error routing --------------------------------------------------
    ...commonErrorCases(),
  ];
}
