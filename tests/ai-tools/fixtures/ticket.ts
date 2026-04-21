import { expect } from 'vitest';
import {
  assertCommonSuccessFields,
  assertDescribeFieldsShape,
  assertDescribeOperationShape,
  assertErrorShape,
  assertItemShape,
  assertListShape,
  assertPaginationConsistent,
  assertPicklistShape,
  assertResolvedLabels,
  assertSlaShape,
  assertTicketSummaryShape,
} from '../assertions/response-shape';
import type { SharedFixtures } from '../context/shared-fixtures';
import { requires } from '../context/shared-fixtures';
import type { TestCase } from '../context/types';

export function getTicketTestCases(fx: SharedFixtures): TestCase[] {
  const ticketId = fx.ticketId;
  const ticketNumber = fx.ticketNumber;
  const companyName = fx.companyName ?? 'TestCompany';

  return [
    // ---- Metadata operations --------------------------------------------------
    {
      name: 'describeFields read',
      args: { operation: 'describeFields', mode: 'read' },
      assert(r) {
        assertDescribeFieldsShape(r);
        assertCommonSuccessFields(r);
        const fields = r.fields as Array<Record<string, unknown>>;
        const hasRequired = fields.some((f) => f.required === true);
        expect(hasRequired, 'at least one read field should be flagged required:true').toBe(true);
      },
    },
    {
      name: 'describeFields write',
      args: { operation: 'describeFields', mode: 'write' },
      assert(r) {
        assertDescribeFieldsShape(r);
        const fields = r.fields as Array<Record<string, unknown>>;
        const hasRequired = fields.some((f) => f.required === true);
        expect(hasRequired, 'at least one write field should have required:true').toBe(true);
      },
    },
    {
      name: 'listPicklistValues status',
      args: { operation: 'listPicklistValues', fieldId: 'status' },
      assert(r) {
        assertPicklistShape(r);
        const values = r.picklistValues as Array<Record<string, unknown>>;
        const hasActive = values.some((v) => v.isActive === true);
        expect(hasActive, 'at least one active picklist entry must be present').toBe(true);
      },
    },
    {
      name: 'describeOperation getMany',
      args: { operation: 'describeOperation', targetOperation: 'getMany' },
      assert(r) {
        assertDescribeOperationShape(r);
      },
    },
    {
      name: 'describeOperation slaHealthCheck',
      args: { operation: 'describeOperation', targetOperation: 'slaHealthCheck' },
      assert(r) {
        assertDescribeOperationShape(r);
      },
    },

    // ---- getMany operations ---------------------------------------------------
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
      name: 'getMany with status filter',
      args: { operation: 'getMany', filter_field: 'status', filter_op: 'eq', filter_value: 1 },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          const summary = r.summary as string;
          expect(summary.length, 'summary must reflect the filter condition').toBeGreaterThan(0);
        }
      },
    },
    {
      name: 'getMany label filter',
      args: {
        operation: 'getMany',
        filter_field: 'companyID',
        filter_value: companyName,
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          assertResolvedLabels(r);
        }
      },
    },
    {
      name: 'getMany OR filter',
      args: {
        operation: 'getMany',
        filter_field: 'status',
        filter_op: 'eq',
        filter_value: 1,
        filter_field_2: 'priority',
        filter_op_2: 'eq',
        filter_value_2: 1,
        filter_logic: 'or',
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
        }
      },
    },
    {
      name: 'getMany exist operator',
      args: { operation: 'getMany', filter_field: 'dueDateTime', filter_op: 'exist' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          const records = r.records as Array<Record<string, unknown>>;
          for (const record of records) {
            expect(
              record.dueDateTime != null,
              `each record must have non-null dueDateTime (exist filter validation). Record id: ${record.id}`
            ).toBe(true);
          }
        }
      },
    },
    {
      name: 'getMany returnAll',
      args: {
        operation: 'getMany',
        returnAll: true,
        filter_field: 'status',
        filter_op: 'eq',
        filter_value: 1,
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(r.continuation, 'continuation must be null when returnAll=true').toBeNull();
          expect(r.isTruncated, '"isTruncated" must be a boolean').toBeTypeOf('boolean');
        }
      },
    },
    {
      name: 'getMany recency',
      args: { operation: 'getMany', recency: 'last_7d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            Object.prototype.hasOwnProperty.call(r, 'nextOffset'),
            'nextOffset must be absent when recency is active'
          ).toBe(false);
          assertCommonSuccessFields(r);
        }
      },
    },
    {
      name: 'getMany recency returnAll',
      args: { operation: 'getMany', recency: 'last_7d', returnAll: true },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            Object.prototype.hasOwnProperty.call(r, 'nextOffset'),
            'nextOffset must be absent when recency is active'
          ).toBe(false);
          expect(r.isTruncated, '"isTruncated" must be a boolean').toBeTypeOf('boolean');
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
      name: 'getMany pagination ceiling',
      args: { operation: 'getMany', offset: 500 },
      assert(r) {
        assertErrorShape(r, 'INVALID_FILTER_CONSTRAINT', { skipNextActionToolCheck: true });
      },
    },
    {
      name: 'getMany filtersJson',
      args: {
        operation: 'getMany',
        filtersJson: '[{"field":"status","op":"eq","value":1}]',
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
        }
      },
    },
    {
      name: 'getMany since filter',
      args: { operation: 'getMany', since: '2020-01-01T00:00:00Z' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          assertPaginationConsistent(r);
        }
      },
    },

    // ---- count operations -----------------------------------------------------
    {
      name: 'count no filters',
      args: { operation: 'count' },
      assert(r) {
        expect(typeof r.matchCount === 'number', '"matchCount" must be a number').toBe(true);
        expect(r.matchCount as number, '"matchCount" must be >= 0').toBeGreaterThanOrEqual(0);
        assertCommonSuccessFields(r);
      },
    },
    {
      name: 'count with filter',
      args: {
        operation: 'count',
        filter_field: 'status',
        filter_op: 'eq',
        filter_value: 1,
      },
      assert(r) {
        expect(typeof r.matchCount === 'number', '"matchCount" must be a number').toBe(true);
        expect(r.matchCount as number, '"matchCount" must be >= 0').toBeGreaterThanOrEqual(0);
        const summary = r.summary as string;
        expect(summary.length, 'summary must reflect the filter condition').toBeGreaterThan(0);
      },
    },

    // ---- get operations -------------------------------------------------------
    {
      name: 'get valid id',
      args: { operation: 'get', id: ticketId },
      requires: [requires.ticketId],
      assert(r) {
        assertItemShape(r);
        const record = r.record as Record<string, unknown>;
        expect(record.id, `record.id must match TEST_TICKET_ID (${ticketId})`).toBe(ticketId);
      },
    },
    {
      name: 'get invalid id',
      args: { operation: 'get', id: 999999999 },
      assert(r) {
        assertErrorShape(r, 'ENTITY_NOT_FOUND');
      },
    },
    {
      name: 'get missing id',
      args: { operation: 'get' },
      assert(r) {
        assertErrorShape(r, 'MISSING_ENTITY_ID');
      },
    },

    // ---- operation routing ----------------------------------------------------
    {
      name: 'invalid operation',
      args: { operation: 'nonExistentOp' },
      assert(r) {
        assertErrorShape(r, 'INVALID_OPERATION');
      },
    },

    // ---- identifier-pair operations (require ticketNumber from beforeAll) -----
    {
      name: 'slaHealthCheck by ticketNumber',
      args: { operation: 'slaHealthCheck', ticketNumber: ticketNumber ?? '' },
      requires: [requires.ticketNumber],
      assert(r) {
        assertSlaShape(r);
        const summary = r.summary as string;
        expect(
          /breached|remaining|hours/i.test(summary),
          `summary must contain SLA signal (breached/remaining/hours), got: "${summary}"`
        ).toBe(true);
      },
    },
    {
      name: 'summary by ticketNumber',
      args: { operation: 'summary', ticketNumber: ticketNumber ?? '' },
      requires: [requires.ticketNumber],
      assert(r) {
        assertTicketSummaryShape(r);
        const summary = r.summary as string;
        // Builder always includes "SLA: breached" or "SLA: not breached"
        expect(
          /SLA:\s*(breached|not breached)/i.test(summary),
          `summary must contain SLA status ("SLA: breached" or "SLA: not breached"), got: "${summary}"`
        ).toBe(true);
        // Builder includes age in hours when available
        expect(
          /Age:\s*\d+(\.\d+)?h/i.test(summary) || summary.length > 0,
          `summary must contain ticket details, got: "${summary}"`
        ).toBe(true);
      },
    },

    // ---- pagination -----------------------------------------------------------
    {
      name: 'pagination with offset',
      args: { operation: 'getMany', offset: 5 },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'INVALID_FILTER_CONSTRAINT', { skipNextActionToolCheck: true });
        } else {
          assertListShape(r);
          assertPaginationConsistent(r);
        }
      },
    },

    // ---- v2.10.0 count injection coverage ------------------------------------
    {
      name: 'getMany completeness verdict — single match',
      args: {
        operation: 'getMany',
        filter_field: 'id',
        filter_op: 'eq',
        filter_value: ticketId,
      },
      requires: [requires.ticketId],
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          // Single-match is below queryLimit — not truncated, no pagination — isIncomplete=false
          expect(r.completenessVerdict, 'single-match must be complete').toBe('complete');
          expect(r.hasMore, 'hasMore must be false for single-match').toBe(false);
          expect(r.continuation, 'continuation must be null for single-match').toBeNull();
          expect(
            Object.prototype.hasOwnProperty.call(r, 'nextOffset'),
            'nextOffset must be absent for single-match'
          ).toBe(false);
        }
      },
    },
    {
      name: 'getMany recency windowLabel — last_7d',
      args: { operation: 'getMany', recency: 'last_7d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 7 days/i.test(r.summary as string),
            `summary must contain "in the last 7 days", got: "${r.summary}"`
          ).toBe(true);
        }
      },
    },
    {
      name: 'getMany recency windowLabel — last_6h',
      args: { operation: 'getMany', recency: 'last_6h' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 6 hours/i.test(r.summary as string),
            `summary must contain "in the last 6 hours", got: "${r.summary}"`
          ).toBe(true);
        }
      },
    },
    {
      name: 'getMany auto-returnAll — last_7d no returnAll param',
      args: { operation: 'getMany', recency: 'last_7d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          // last_7d is a short window (<=7d) — auto-returnAll must be active.
          // If not truncated: complete set, continuation=null.
          if (r.isTruncated === false) {
            expect(r.continuation, 'continuation must be null for auto-returnAll complete result').toBeNull();
            expect(r.completenessVerdict, 'must be complete when not truncated').toBe('complete');
          }
          // If truncated (payload cap hit during auto-returnAll): truncationReason must use payload-cap wording,
          // NOT offset-cap wording (validates wasReturnAll routing in computeListContinuation).
          if (r.isTruncated === true) {
            expect(r.truncationReason, 'truncationReason must be present when truncated').toBeTruthy();
            expect(
              /payload.*capped|capped.*payload|Fetched all matching/i.test(r.truncationReason as string),
              `truncationReason must use payload-cap wording, got: "${r.truncationReason}"`
            ).toBe(true);
            expect(
              /offset.*cap|pagination.*cap/i.test(r.truncationReason as string),
              `truncationReason must NOT say "offset cap" for auto-returnAll, got: "${r.truncationReason}"`
            ).toBe(false);
          }
        }
      },
    },
    {
      name: 'getMany recency long window — last_30d',
      args: { operation: 'getMany', recency: 'last_30d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 30 days/i.test(r.summary as string),
            `summary must contain "in the last 30 days", got: "${r.summary}"`
          ).toBe(true);
          // Long window (>7d): recency offset pagination disabled, continuation must be null
          expect(r.continuation, 'continuation must be null for long recency (no offset pagination)').toBeNull();
          // If truncated: count injection must have fired (Path A parallel) — totalAvailable present
          if (r.isTruncated === true) {
            expect(
              Object.prototype.hasOwnProperty.call(r, 'totalAvailable'),
              'totalAvailable must be injected when truncated on long recency window'
            ).toBe(true);
            expect(r.totalAvailable as number, 'totalAvailable must be >= returnedCount').toBeGreaterThanOrEqual(r.returnedCount as number);
            expect(r.completenessVerdict, 'must be incomplete when truncated').toBe('incomplete');
            // Summary must guide toward narrowing, not offset pagination (recency-aware Branch 5)
            expect(
              /Narrow the recency window|narrow.*filter/i.test(r.summary as string),
              `summary must suggest narrowing recency window, got: "${r.summary}"`
            ).toBe(true);
            expect(
              /Offset cap reached/i.test(r.summary as string),
              `summary must NOT say "Offset cap reached" for recency paths, got: "${r.summary}"`
            ).toBe(false);
          }
        }
      },
    },
    {
      name: 'getMany recency preset — last_1d',
      args: { operation: 'getMany', recency: 'last_1d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 1 day/i.test(r.summary as string),
            `summary must contain "in the last 1 day", got: "${r.summary}"`
          ).toBe(true);
        }
      },
    },
    {
      name: 'getMany recency preset — last_2d',
      args: { operation: 'getMany', recency: 'last_2d' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 2 days/i.test(r.summary as string),
            `summary must contain "in the last 2 days", got: "${r.summary}"`
          ).toBe(true);
        }
      },
    },
    {
      name: 'getMany recency preset — last_3h',
      args: { operation: 'getMany', recency: 'last_3h' },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(
            /in the last 3 hours/i.test(r.summary as string),
            `summary must contain "in the last 3 hours", got: "${r.summary}"`
          ).toBe(true);
        }
      },
    },
    {
      name: 'getMany date field filter warns',
      args: {
        operation: 'getMany',
        filter_field: 'createDate',
        filter_op: 'gte',
        filter_value: '2020-01-01T00:00:00Z',
        filter_field_2: 'createDate',
        filter_op_2: 'lte',
        filter_value_2: '2030-01-01T00:00:00Z',
      },
      assert(r) {
        if (r.error) {
          // Error is acceptable (e.g. if sandbox API rejects date range filters)
          assertErrorShape(r);
        } else {
          assertListShape(r);
          // Must emit a warning steering LLM toward recency/since/until
          expect(Array.isArray(r.warnings), 'warnings must be an array').toBe(true);
          const warnings = r.warnings as string[];
          const hasDateWarning = warnings.some(
            (w) => /date.*field|recency|since.*until/i.test(w)
          );
          expect(hasDateWarning, `warnings must include a date-field hint, got: ${JSON.stringify(warnings)}`).toBe(true);
        }
      },
    },
    {
      name: 'getMany returnAll completeness signals',
      args: {
        operation: 'getMany',
        returnAll: true,
        filter_field: 'status',
        filter_op: 'eq',
        filter_value: 1,
      },
      assert(r) {
        if (r.error) {
          assertErrorShape(r, 'NO_RESULTS_FOUND');
        } else {
          assertListShape(r);
          expect(r.continuation, 'continuation must be null when returnAll=true').toBeNull();
          if (r.isTruncated === false) {
            // All records returned — complete
            expect(r.completenessVerdict, 'must be complete when not truncated').toBe('complete');
          } else {
            // Payload cap hit (>100 matching records) — totalAvailable injected, payload-cap wording
            expect(
              Object.prototype.hasOwnProperty.call(r, 'totalAvailable'),
              'totalAvailable must be injected when payload-capped during returnAll'
            ).toBe(true);
            expect(r.completenessVerdict, 'must be incomplete when payload-capped').toBe('incomplete');
            expect(r.truncationReason, 'truncationReason must be present').toBeTruthy();
            expect(
              /payload.*capped|capped.*payload|Fetched all matching/i.test(r.truncationReason as string),
              `truncationReason must use payload-cap wording, got: "${r.truncationReason}"`
            ).toBe(true);
            // Branch 3 summary wording (Nice-to-have from Gap 10)
            expect(
              /fetched but omitted from payload|Use 'fields' to shrink/i.test(r.summary as string),
              `summary must use payload-cap wording, got: "${r.summary}"`
            ).toBe(true);
          }
        }
      },
    },
  ];
}
