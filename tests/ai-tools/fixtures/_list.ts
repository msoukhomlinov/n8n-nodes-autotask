import { expect } from 'vitest';
import {
  assertListShape,
  assertPaginationConsistent,
  assertCommonSuccessFields,
  assertErrorShape,
} from '../assertions/response-shape';
import type { SharedFixtures } from '../context/shared-fixtures';
import type { TestCase } from '../context/types';

/**
 * Standard getMany + count cases for resources with no required parent filter.
 * Resources with parent-scoped lists (ticketNote, timeEntry) should add
 * their own getMany-by-parent cases instead of using this factory.
 */
export function listOperationCases(fx: SharedFixtures): TestCase[] {
  return [
    {
      name: 'getMany no filters',
      args: { operation: 'getMany' },
      assert(r) {
        assertListShape(r);
        assertPaginationConsistent(r);
        assertCommonSuccessFields(r);
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
      name: 'count no filters',
      args: { operation: 'count' },
      assert(r) {
        expect(typeof r.matchCount === 'number', '"matchCount" must be a number').toBe(true);
        expect(r.matchCount as number, '"matchCount" must be >= 0').toBeGreaterThanOrEqual(0);
        assertCommonSuccessFields(r);
      },
    },
  ];
}
