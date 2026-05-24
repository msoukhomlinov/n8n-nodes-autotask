import { expect } from 'vitest';
import {
  assertCommonSuccessFields,
  assertErrorShape,
  assertItemShape,
  assertListShape,
  assertMutationShape,
  assertPaginationConsistent,
  assertIdBelongsToParent,
} from '../assertions/response-shape';
import type { SharedFixtures } from '../context/shared-fixtures';
import { requires } from '../context/shared-fixtures';
import { commonMetadataCases, commonErrorCases } from './_common';
import type { TestCase } from '../context/types';

export function getTicketNoteTestCases(fx: SharedFixtures): TestCase[] {
  return [
    // ---- Metadata -------------------------------------------------------
    ...commonMetadataCases({ describeOpTarget: 'getMany', listPicklistFieldId: 'noteType' }),

    // ---- getMany --------------------------------------------------------
    {
      name: 'getMany by ticket',
      args: {
        operation: 'getMany',
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
    {
      name: 'getMany no results',
      args: {
        operation: 'getMany',
        filter_field: 'title',
        filter_op: 'eq',
        filter_value: '__nonexistent_xyzzy__',
      },
      assert(r) {
        assertErrorShape(r, 'NO_RESULTS_FOUND');
      },
    },
    {
      name: 'getMany filtersJson',
      args: {
        operation: 'getMany',
        filtersJson: JSON.stringify([{ field: 'ticketID', op: 'eq', value: fx.ticketId || 0 }]),
      },
      requires: [requires.ticketId],
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
        }
      },
    },

    // ---- get ------------------------------------------------------------
    {
      name: 'get valid id',
      args: { operation: 'get', id: fx.ticketNoteId ?? fx.bogusId },
      requires: [requires.ticketNoteId],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match ticketNoteId (${fx.ticketNoteId})`).toBe(fx.ticketNoteId);
        // Parent ticket check omitted: TEST_TICKET_NOTE_ID override may point to a different ticket
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

    // ---- write ----------------------------------------------------------
    {
      name: 'create note',
      args: {
        operation: 'create',
        ticketID: fx.ticketId,
        title: `__test_note_${Date.now()}`,
        noteType: 1,
        publish: 1,
      },
      requires: [requires.ticketId],
      isWrite: true,
      assert(r) {
        assertMutationShape(r);
        assertIdBelongsToParent(r, 'ticketID', fx.ticketId);
      },
    },

    // ---- error routing --------------------------------------------------
    ...commonErrorCases(),
  ];
}
