import {
  assertCommonSuccessFields,
  assertDescribeFieldsShape,
  assertDescribeOperationShape,
  assertErrorShape,
  assertPicklistShape,
} from '../assertions/response-shape';
import type { TestCase } from '../context/types';

export interface CommonMetadataOpts {
  /** Target operation for describeOperation case. Default: 'getMany'. */
  describeOpTarget?: string;
  /**
   * If provided, adds a listPicklistValues case for this fieldId.
   * Pass a field known to have picklist values for the resource (e.g. 'status', 'noteType').
   */
  listPicklistFieldId?: string;
}

/**
 * Metadata cases valid for every resource: describeFields read/write, describeOperation,
 * and optionally listPicklistValues.
 * Note: ticket.ts does NOT use this factory — it keeps its own inline metadata cases.
 */
export function commonMetadataCases(opts?: CommonMetadataOpts): TestCase[] {
  const describeTarget = opts?.describeOpTarget ?? 'getMany';
  const cases: TestCase[] = [
    {
      name: 'describeFields read',
      args: { operation: 'describeFields', mode: 'read' },
      assert(r) {
        assertDescribeFieldsShape(r);
        assertCommonSuccessFields(r);
      },
    },
    {
      name: 'describeFields write',
      args: { operation: 'describeFields', mode: 'write' },
      assert(r) {
        assertDescribeFieldsShape(r);
      },
    },
    {
      name: `describeOperation ${describeTarget}`,
      args: { operation: 'describeOperation', targetOperation: describeTarget },
      assert(r) {
        assertDescribeOperationShape(r);
      },
    },
  ];

  if (opts?.listPicklistFieldId) {
    const fieldId = opts.listPicklistFieldId;
    cases.push({
      name: `listPicklistValues ${fieldId}`,
      args: { operation: 'listPicklistValues', fieldId },
      assert(r) {
        assertPicklistShape(r);
      },
    });
  }

  return cases;
}

/**
 * Error cases valid for every resource that supports `get`:
 * invalid operation routing, get with missing id.
 * All 6 resources (ticket, ticketNote, timeEntry, company, contact, resource)
 * support the `get` operation — this factory is safe to use for all of them.
 */
export function commonErrorCases(): TestCase[] {
  return [
    {
      name: 'invalid operation',
      args: { operation: 'nonExistentOp' },
      assert(r) {
        assertErrorShape(r, 'INVALID_OPERATION');
      },
    },
    {
      name: 'get missing id',
      args: { operation: 'get' },
      assert(r) {
        assertErrorShape(r, 'MISSING_ENTITY_ID');
      },
    },
  ];
}
