import { expect } from 'vitest';

// Import production error types to avoid drift
import { ERROR_TYPES } from '../../../nodes/Autotask/ai-tools/error-formatter';

const KNOWN_ERROR_TYPES: Set<string> = new Set(Object.values(ERROR_TYPES));

/**
 * Error types where nextAction must reference the tool name (`autotask_ticket`)
 * and a specific operation. For constraint/boundary errors (INVALID_FILTER_CONSTRAINT etc.),
 * nextAction provides guidance text but may not name a tool.
 */
// Only error types whose production nextAction string references the tool name
// (e.g. "Use autotask_ticket with operation 'getMany'").
// INVALID_OPERATION nextAction = "Use one of: <ops list>" — no tool name.
// WRITE_OPERATION_BLOCKED nextAction = "Use a read operation such as..." — no tool name.
const NEXT_ACTION_REQUIRES_TOOL_NAME = new Set([
  'ENTITY_NOT_FOUND',
  'NO_RESULTS_FOUND',
  'MISSING_ENTITY_ID',
]);

export type AssertErrorOpts = {
  /**
   * When true, skip the assertion that nextAction contains "autotask_ticket".
   * Use for INVALID_FILTER_CONSTRAINT and other boundary errors where nextAction
   * contains actionable guidance but not necessarily a tool name.
   */
  skipNextActionToolCheck?: boolean;
};

// ---------------------------------------------------------------------------
// Success response helpers
// ---------------------------------------------------------------------------

/**
 * Asserts fields present on ALL successful responses.
 * Do NOT call on error responses — errors omit the `warnings` field.
 */
export function assertCommonSuccessFields(r: Record<string, unknown>): void {
  expect(r.summary, 'summary must be a non-empty string').toBeTypeOf('string');
  expect((r.summary as string).length, 'summary must not be empty').toBeGreaterThan(0);
  expect(r.resource, 'resource must be a string').toBeTypeOf('string');
  expect(r.operation, 'operation must be a string').toBeTypeOf('string');
  expect(Array.isArray(r.warnings), 'warnings must be an array on success responses').toBe(true);
}

export function assertValidSummary(r: Record<string, unknown>): void {
  expect(r.summary, 'summary must be a non-empty string').toBeTypeOf('string');
  expect((r.summary as string).length, 'summary must not be empty').toBeGreaterThan(0);
}

export function assertNoResultWrapper(r: Record<string, unknown>): void {
  expect(Object.prototype.hasOwnProperty.call(r, 'result'), 'response must not have a "result" wrapper key').toBe(false);
}

// ---------------------------------------------------------------------------
// List response
// ---------------------------------------------------------------------------

export function assertListShape(r: Record<string, unknown>): void {
  assertNoResultWrapper(r);
  expect(Array.isArray(r.records), '"records" must be an array').toBe(true);
  const records = r.records as unknown[];
  expect(r.returnedCount, '"returnedCount" must equal records.length').toBe(records.length);
  expect(r.hasMore, '"hasMore" must be a boolean').toBeTypeOf('boolean');
  // continuation: null or an object (never undefined — always emitted)
  const continuationIsValid =
    r.continuation === null ||
    (typeof r.continuation === 'object' && r.continuation !== null);
  expect(continuationIsValid, '"continuation" must be null or an object').toBe(true);
  expect(r.isTruncated, '"isTruncated" must be a boolean').toBeTypeOf('boolean');
  expect(r.serverCap, '"serverCap" must be a number').toBeTypeOf('number');
  expect(r.clientCap, '"clientCap" must be a number').toBeTypeOf('number');
  // v2.10.0: completenessVerdict always present on list responses
  expect(
    ['complete', 'incomplete'].includes(r.completenessVerdict as string),
    `"completenessVerdict" must be 'complete' or 'incomplete', got: ${JSON.stringify(r.completenessVerdict)}`
  ).toBe(true);
  // v2.10.0: completenessVerdict consistency — complete implies hasMore=false and continuation=null
  if (r.completenessVerdict === 'complete') {
    expect(r.hasMore, 'hasMore must be false when completenessVerdict is complete').toBe(false);
    expect(r.continuation, 'continuation must be null when completenessVerdict is complete').toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(r, 'nextOffset'),
      'nextOffset must be absent when completenessVerdict is complete'
    ).toBe(false);
  }
  // v2.10.0: totalAvailable must be a number when present
  if (Object.prototype.hasOwnProperty.call(r, 'totalAvailable')) {
    expect(r.totalAvailable, '"totalAvailable" must be a number when present').toBeTypeOf('number');
    expect(r.totalAvailable as number, '"totalAvailable" must be >= returnedCount').toBeGreaterThanOrEqual(r.returnedCount as number);
  }
}

export function assertPaginationConsistent(r: Record<string, unknown>): void {
  if (r.hasMore === true) {
    expect(r.nextOffset, 'nextOffset must be present when hasMore=true').toBeDefined();
  } else {
    expect(
      Object.prototype.hasOwnProperty.call(r, 'nextOffset'),
      'nextOffset must be absent when hasMore=false'
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Item response
// ---------------------------------------------------------------------------

export function assertItemShape(r: Record<string, unknown>): void {
  assertNoResultWrapper(r);
  // buildItemResponse emits { summary, resource, operation, record, warnings } — no top-level id.
  // Top-level id only appears in mutation responses (buildMutationResponse / buildDeleteResponse).
  expect(r.record !== null && typeof r.record === 'object', '"record" must be a non-null object').toBe(true);
}

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export function assertErrorShape(
  r: Record<string, unknown>,
  errorType?: string,
  opts: AssertErrorOpts = {}
): void {
  expect(r.error, '"error" must be true').toBe(true);
  expect(r.errorType, '"errorType" must be a string').toBeTypeOf('string');
  const actualType = r.errorType as string;
  expect(
    KNOWN_ERROR_TYPES.has(actualType),
    `"errorType" must be a known constant, got: "${actualType}". ` +
    `Known types: ${[...KNOWN_ERROR_TYPES].join(', ')}`
  ).toBe(true);

  if (errorType !== undefined) {
    expect(r.errorType, `errorType must be "${errorType}"`).toBe(errorType);
  }

  const needsToolCheck =
    !opts.skipNextActionToolCheck &&
    NEXT_ACTION_REQUIRES_TOOL_NAME.has(actualType);

  if (needsToolCheck) {
    expect(r.nextAction, '"nextAction" must be a string for this error type').toBeTypeOf('string');
    const nextAction = r.nextAction as string;
    expect(
      nextAction.includes('autotask_ticket'),
      `nextAction must reference "autotask_ticket", got: "${nextAction}"`
    ).toBe(true);
    // Must also name a specific operation — matches patterns like: operation 'getMany', operation:"get"
    const operationPattern = /operation\s*['":]?\s*\w+/i;
    expect(
      operationPattern.test(nextAction),
      `nextAction must reference a specific operation, got: "${nextAction}"`
    ).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Domain-specific helpers
// ---------------------------------------------------------------------------

export function assertResolvedLabels(r: Record<string, unknown>): void {
  expect(Array.isArray(r.resolvedLabels), '"resolvedLabels" must be an array').toBe(true);
  const labels = r.resolvedLabels as Array<Record<string, unknown>>;
  expect(labels.length, '"resolvedLabels" must be non-empty').toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.field, 'each resolvedLabel must have "field" (string)').toBeTypeOf('string');
    expect(label.from, 'each resolvedLabel must have "from"').toBeDefined();
    expect(label.to, 'each resolvedLabel must have "to"').toBeDefined();
  }
}

export function assertSlaShape(r: Record<string, unknown>): void {
  expect(r.record !== null && typeof r.record === 'object', '"record" must be a non-null object').toBe(true);
  const record = r.record as Record<string, unknown>;
  expect(record.isBreached, '"record.isBreached" must be a boolean').toBeTypeOf('boolean');
  expect(
    record.wallClockRemainingHours,
    '"record.wallClockRemainingHours" must be a number'
  ).toBeTypeOf('number');
}

export function assertTicketSummaryShape(r: Record<string, unknown>): void {
  expect(r.ticketSummary !== null && typeof r.ticketSummary === 'object', '"ticketSummary" must be a non-null object').toBe(true);
  expect(
    Object.prototype.hasOwnProperty.call(r, 'record'),
    'summary response must use "ticketSummary" key, not "record"'
  ).toBe(false);
  const ts = r.ticketSummary as Record<string, unknown>;
  expect(ts.core !== null && typeof ts.core === 'object', '"ticketSummary.core" must be a non-null object').toBe(true);
  expect(ts.computed !== null && typeof ts.computed === 'object', '"ticketSummary.computed" must be a non-null object').toBe(true);
}

export function assertDescribeFieldsShape(r: Record<string, unknown>): void {
  expect(Array.isArray(r.fields), '"fields" must be an array').toBe(true);
  const fields = r.fields as Array<Record<string, unknown>>;
  expect(fields.length, '"fields" must not be empty').toBeGreaterThan(0);
  for (const field of fields) {
    expect(field.id, 'each field entry must have an "id" string').toBeTypeOf('string');
  }
}

export function assertPicklistShape(r: Record<string, unknown>): void {
  expect(Array.isArray(r.picklistValues), '"picklistValues" must be an array').toBe(true);
  const values = r.picklistValues as unknown[];
  expect(values.length, '"picklistValues" must not be empty').toBeGreaterThan(0);
}

export function assertDescribeOperationShape(r: Record<string, unknown>): void {
  expect(r.operationDoc, '"operationDoc" must be present').toBeTruthy();
  expect(typeof r.operationDoc, '"operationDoc" must be an object').toBe('object');
  expect(r.summary, '"summary" must be a non-empty string').toBeTypeOf('string');
  expect((r.summary as string).length, 'summary must not be empty').toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Mutation / write response helpers
// ---------------------------------------------------------------------------

/**
 * Asserts shape of create/update mutation responses.
 * Expected top-level keys: id (number), record (object), summary, resource, operation, warnings.
 */
export function assertMutationShape(r: Record<string, unknown>): void {
  assertNoResultWrapper(r);
  assertCommonSuccessFields(r);
  expect(r.id, '"id" must be a number on mutation responses').toBeTypeOf('number');
  expect(r.record !== null && typeof r.record === 'object', '"record" must be a non-null object on mutations').toBe(true);
}

/**
 * Asserts shape of delete responses.
 * Expected top-level keys: id (number), summary, resource, operation, warnings.
 */
export function assertDeleteShape(r: Record<string, unknown>): void {
  assertNoResultWrapper(r);
  assertCommonSuccessFields(r);
  expect(r.id, '"id" must be a number on delete responses').toBeTypeOf('number');
}

/**
 * Asserts shape of compound responses (createIfNotExists).
 * Expected top-level keys: outcome ('created'|'found'|'skipped'), summary, resource, operation, warnings.
 */
export function assertCompoundShape(r: Record<string, unknown>): void {
  assertNoResultWrapper(r);
  assertCommonSuccessFields(r);
  expect(
    ['created', 'found', 'skipped'].includes(r.outcome as string),
    `"outcome" must be 'created', 'found', or 'skipped', got: ${JSON.stringify(r.outcome)}`
  ).toBe(true);
}

/**
 * Asserts that a response's record belongs to the expected parent entity.
 * Used for child resources (ticketNote, timeEntry) to verify parent relationship.
 */
export function assertIdBelongsToParent(
  r: Record<string, unknown>,
  parentField: string,
  parentId: number
): void {
  const record = r.record as Record<string, unknown> | undefined;
  if (record) {
    expect(record[parentField], `record.${parentField} must equal parent id ${parentId}`).toBe(parentId);
  }
}
