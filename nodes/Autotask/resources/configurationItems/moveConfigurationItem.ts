import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../../helpers/http';
import { ATTACHMENT_TYPE, MAX_ATTACHMENT_SIZE_BYTES } from '../../helpers/attachment';
import { withInactiveRefRetry } from '../../helpers/inactive-entity-activation';
import { getWritableFieldNames, applyRequiredFieldDefaults, buildEntityDeepLink } from '../../helpers/entity';

type MaskedUdfPolicy = 'omit' | 'fail';
type OversizePolicy = 'skip+note' | 'fail';
type PartialFailureStrategy = 'deactivateDestination' | 'leaveActiveWithNote';

interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  jitter: boolean;
}

interface ThrottlePolicy {
  maxBytesPer5Min: number;
  maxSingleFileBytes: number;
}

interface MoveConfigurationItemOptions {
  sourceConfigurationItemId: number;
  destinationCompanyId: number;
  destinationCompanyLocationId: number | null;
  destinationContactId: number | null;
  copyUdfs: boolean;
  copyAttachments: boolean;
  copyNotes: boolean;
  copyNoteAttachments: boolean;
  deactivateSource: boolean;
  sourceAuditNote: string;
  destinationAuditNote: string;
  dryRun: boolean;
  idempotencyKey: string | null;
  includeMaskedUdfsPolicy: MaskedUdfPolicy;
  attachmentOversizePolicy: OversizePolicy;
  partialFailureStrategy: PartialFailureStrategy;
  retryPolicy: RetryPolicy;
  throttlePolicy: ThrottlePolicy;
}

interface MigrationCounters {
  notesCopied: number;
  attachmentsCopied: number;
  noteAttachmentsCopied: number;
}

interface SkippedCollections {
  udfs: string[];
  attachments: string[];
  noteAttachments: string[];
}

interface MigrationStatus {
  warnings: string[];
  skipped: SkippedCollections;
  sourceDeactivated: boolean;
  auditNotesCreated: boolean;
}

interface MigrationMappings {
  notes: Record<string, number>;
  attachments: Record<string, number>;
  noteAttachments: Record<string, number>;
}

interface LatencyPerPhase {
  preflightMs: number;
  createMs: number;
  copyAttachmentsMs: number;
  copyNotesMs: number;
  copyNoteAttachmentsMs: number;
  auditNotesMs: number;
  deactivateSourceMs: number;
  totalMs: number;
}

interface ThrottleState {
  uploads: Array<{ timestampMs: number; bytes: number }>;
}

const PHASE_WINDOW_MS = 5 * 60 * 1000;
const NOTE_TRUNCATE_LEN = 32000;


function nowUtcIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function asPositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function asOptionalPositiveInt(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Optional ID values must be positive integers when provided');
  }
  return parsed;
}

/**
 * Extract the numeric entity ID from an autotaskApiRequest POST response.
 * The helper normalises responses to `{ item: { itemId | id } }`, but
 * callers historically cast to `{ itemId }` — handle both shapes.
 */
function extractCreatedId(response: IDataObject): number | null {
  const item = response?.item as IDataObject | undefined;
  const id = item?.itemId ?? item?.id ?? response?.itemId ?? response?.id;
  return typeof id === 'number' && id > 0 ? id : null;
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('timeout') ||
    message.includes('temporarily') ||
    message.includes('gateway') ||
    message.includes('service unavailable') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(
  task: () => Promise<T>,
  retryPolicy: RetryPolicy,
): Promise<T> {
  let delayMs = Math.max(50, retryPolicy.baseDelayMs);
  for (let attempt = 1; attempt <= retryPolicy.maxRetries + 1; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt > retryPolicy.maxRetries || !isTransientError(error)) {
        throw error;
      }
      const jitterMs = retryPolicy.jitter ? Math.floor(Math.random() * delayMs * 0.3) : 0;
      await sleepMs(delayMs + jitterMs);
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  }
  throw new Error('Retry execution exhausted without result');
}

function ensureThrottleWindow(state: ThrottleState, nowMs: number): void {
  const minTs = nowMs - PHASE_WINDOW_MS;
  state.uploads = state.uploads.filter((entry) => entry.timestampMs >= minTs);
}

async function throttleForUpload(
  state: ThrottleState,
  bytesToUpload: number,
  policy: ThrottlePolicy,
): Promise<void> {
  const nowMs = Date.now();
  ensureThrottleWindow(state, nowMs);
  let usedBytes = state.uploads.reduce((sum, entry) => sum + entry.bytes, 0);
  if (usedBytes + bytesToUpload <= policy.maxBytesPer5Min) {
    return;
  }

  while (state.uploads.length > 0 && usedBytes + bytesToUpload > policy.maxBytesPer5Min) {
    const oldest = state.uploads[0];
    if (!oldest) break;
    const waitMs = oldest.timestampMs + PHASE_WINDOW_MS - Date.now();
    if (waitMs > 0) {
      await sleepMs(waitMs);
    }
    ensureThrottleWindow(state, Date.now());
    usedBytes = state.uploads.reduce((sum, entry) => sum + entry.bytes, 0);
  }
}

function buildMigrationHeader(sourceConfigurationItemId: number, sourceCompanyId: number): string {
  return `[MIGRATED] From CI ${sourceConfigurationItemId} (Company ${sourceCompanyId}) on ${nowUtcIso()} by n8n-nodes-autotask`;
}

function resolveTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

function truncateText(value: string): string {
  if (value.length <= NOTE_TRUNCATE_LEN) return value;
  return `${value.slice(0, NOTE_TRUNCATE_LEN - 3)}...`;
}

function parseCopyOptions(context: IExecuteFunctions, itemIndex: number): MoveConfigurationItemOptions {
  const sourceConfigurationItemId = asPositiveInt(
    context.getNodeParameter('sourceConfigurationItemId', itemIndex) as string,
    'Source Configuration Item ID',
  );
  const destinationCompanyId = asPositiveInt(
    context.getNodeParameter('destinationCompanyId', itemIndex) as string,
    'Destination Company ID',
  );
  const destinationCompanyLocationId = asOptionalPositiveInt(
    context.getNodeParameter('destinationCompanyLocationId', itemIndex, '') as string,
  );
  const destinationContactId = asOptionalPositiveInt(
    context.getNodeParameter('destinationContactId', itemIndex, '') as string,
  );

  const copyUdfs = context.getNodeParameter('copyUdfs', itemIndex, true) as boolean;
  const copyAttachments = context.getNodeParameter('copyAttachments', itemIndex, true) as boolean;
  const copyNotes = context.getNodeParameter('copyNotes', itemIndex, true) as boolean;
  const copyNoteAttachments = context.getNodeParameter('copyNoteAttachments', itemIndex, true) as boolean;
  const deactivateSource = context.getNodeParameter('deactivateSource', itemIndex, true) as boolean;
  const sourceAuditNote = (context.getNodeParameter('sourceAuditNote', itemIndex, '') as string).trim();
  const destinationAuditNote = (context.getNodeParameter('destinationAuditNote', itemIndex, '') as string).trim();
  const dryRun = context.getNodeParameter('dryRun', itemIndex, false) as boolean;
  const idempotencyRaw = (context.getNodeParameter('idempotencyKey', itemIndex, '') as string).trim();
  const includeMaskedUdfsPolicy = context.getNodeParameter('includeMaskedUdfsPolicy', itemIndex, 'omit') as MaskedUdfPolicy;
  const attachmentOversizePolicy = context.getNodeParameter('attachmentOversizePolicy', itemIndex, 'skip+note') as OversizePolicy;
  const partialFailureStrategy = context.getNodeParameter(
    'partialFailureStrategy',
    itemIndex,
    'deactivateDestination',
  ) as PartialFailureStrategy;

  const retryPolicy: RetryPolicy = {
    maxRetries: Math.max(0, Math.trunc(context.getNodeParameter('retryMaxRetries', itemIndex, 3) as number)),
    baseDelayMs: Math.max(50, Math.trunc(context.getNodeParameter('retryBaseDelayMs', itemIndex, 500) as number)),
    jitter: context.getNodeParameter('retryJitter', itemIndex, true) as boolean,
  };
  const throttlePolicy: ThrottlePolicy = {
    maxBytesPer5Min: Math.max(1, Math.trunc(context.getNodeParameter('throttleMaxBytesPer5Min', itemIndex, 10000000) as number)),
    maxSingleFileBytes: Math.max(
      1,
      Math.trunc(context.getNodeParameter('throttleMaxSingleFileBytes', itemIndex, MAX_ATTACHMENT_SIZE_BYTES) as number),
    ),
  };

  return {
    sourceConfigurationItemId,
    destinationCompanyId,
    destinationCompanyLocationId,
    destinationContactId,
    copyUdfs,
    copyAttachments,
    copyNotes,
    copyNoteAttachments,
    deactivateSource,
    sourceAuditNote,
    destinationAuditNote,
    dryRun,
    idempotencyKey: idempotencyRaw === '' ? null : idempotencyRaw,
    includeMaskedUdfsPolicy,
    attachmentOversizePolicy,
    partialFailureStrategy,
    retryPolicy,
    throttlePolicy,
  };
}

async function fetchEntityById(
  context: IExecuteFunctions,
  endpoint: string,
  missingMessage: string,
): Promise<IDataObject> {
  const response = await autotaskApiRequest.call(context, 'GET', endpoint) as { item?: IDataObject };
  if (!response?.item || typeof response.item !== 'object') {
    throw new Error(missingMessage);
  }
  return response.item;
}

async function queryAll(
  context: IExecuteFunctions,
  endpoint: string,
  filter: Array<{ field: string; op: string; value: unknown }>,
  includeFields?: string[],
): Promise<IDataObject[]> {
  const body: IDataObject = {
    filter,
    MaxRecords: 500,
  };
  if (includeFields && includeFields.length > 0) {
    body.IncludeFields = includeFields as unknown as IDataObject;
  }

  const first = await autotaskApiRequest.call(context, 'POST', endpoint, body) as {
    items?: IDataObject[];
    pageDetails?: { nextPageUrl?: string | null };
  };
  const results: IDataObject[] = [...(first.items ?? [])];
  let nextPageUrl = first.pageDetails?.nextPageUrl;

  while (nextPageUrl) {
    const next = await autotaskApiRequest.call(context, 'POST', nextPageUrl, body) as {
      items?: IDataObject[];
      pageDetails?: { nextPageUrl?: string | null };
    };
    results.push(...(next.items ?? []));
    nextPageUrl = next.pageDetails?.nextPageUrl;
  }

  return results;
}

async function queryCount(
  context: IExecuteFunctions,
  endpoint: string,
  filter: Array<{ field: string; op: string; value: unknown }>,
): Promise<number | null> {
  try {
    const response = await autotaskApiRequest.call(context, 'POST', endpoint, { filter }) as { queryCount?: number };
    return typeof response.queryCount === 'number' ? response.queryCount : null;
  } catch {
    return null;
  }
}

function readNoteDescription(note: IDataObject): string {
  const candidates = ['description', 'note', 'text', 'content'];
  for (const key of candidates) {
    const value = note[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

function buildDestinationCiPayload(
  sourceCi: IDataObject,
  options: MoveConfigurationItemOptions,
  writableFieldNames: Set<string>,
  skippedUdfs: string[],
  warnings: string[],
): IDataObject {
  const payload: IDataObject = { id: 0 };
  for (const fieldName of writableFieldNames) {
    if (fieldName === 'id') continue;
    if (fieldName === 'userDefinedFields') continue;
    if (fieldName === 'parentConfigurationItemID') continue;
    const value = sourceCi[fieldName];
    if (value !== undefined) {
      payload[fieldName] = value;
    }
  }

  payload.companyID = options.destinationCompanyId;
  payload.companyLocationID = options.destinationCompanyLocationId ?? null;
  payload.contactID = options.destinationContactId ?? null;
  payload.isActive = 1;

  if (options.copyUdfs && Array.isArray(sourceCi.userDefinedFields)) {
    const copiedUdfs: IDataObject[] = [];
    for (const udfRaw of sourceCi.userDefinedFields) {
      if (!udfRaw || typeof udfRaw !== 'object') continue;
      const udf = udfRaw as IDataObject;
      const udfName = typeof udf.name === 'string' ? udf.name : `udf_${String(udf.id ?? 'unknown')}`;
      const value = udf.value;
      if (value === '*****') {
        if (options.includeMaskedUdfsPolicy === 'fail') {
          throw new Error(`Masked UDF '${udfName}' detected and includeMaskedUdfsPolicy is set to fail`);
        }
        skippedUdfs.push(udfName);
        continue;
      }
      copiedUdfs.push({ ...udf });
    }
    if (copiedUdfs.length > 0) {
      payload.userDefinedFields = copiedUdfs;
    }
    if (skippedUdfs.length > 0) {
      warnings.push(`Masked UDFs were omitted: ${skippedUdfs.join(', ')}`);
    }
  }

  return payload;
}

/**
 * Regex for the Autotask error format that names the offending reference field
 * but does NOT include the entity ID:
 *   "Reference value on field: createdByPersonID of configurationItemType: Resource does not exist or is invalid."
 *   "Value does not reference an existing entity for lastActivityPersonID."
 */
const BAD_REF_FIELD_PATTERN =
  /(?:Reference value on field:\s*(\w+)|Value does not reference an existing entity for\s+(\w+))/i;

/**
 * Attempt to create a CI; on a bad-reference error that `withInactiveRefRetry`
 * cannot handle (no entity ID in the message), strip the offending field from
 * the payload, warn, and retry.  Gives up after 5 stripped fields to avoid
 * infinite loops.
 */
async function createCiWithReferenceFieldFallback(
  context: IExecuteFunctions,
  payload: IDataObject,
  warnings: string[],
): Promise<number> {
  const MAX_STRIPS = 5;

  for (let attempt = 0; attempt <= MAX_STRIPS; attempt++) {
    try {
      const response = await withInactiveRefRetry(
        context,
        warnings,
        async () => autotaskApiRequest.call(
          context,
          'POST',
          'ConfigurationItems/',
          payload,
        ) as Promise<IDataObject>,
      );

      const id = extractCreatedId(response);
      if (id !== null) return id;
      throw new Error('Failed to create destination configuration item: no itemId returned');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const match = BAD_REF_FIELD_PATTERN.exec(msg);
      const badField = match?.[1] ?? match?.[2];

      if (!badField || !(badField in payload)) throw error;
      if (attempt >= MAX_STRIPS) throw error;

      const strippedValue = payload[badField];
      delete payload[badField];
      warnings.push(
        `Field "${badField}" (value: ${strippedValue}) references an inactive or deleted entity and was stripped from the destination configuration item.`,
      );
    }
  }

  // Should not be reached, but satisfy TypeScript.
  throw new Error('Exhausted reference-field strip retries');
}

async function addAuditNote(
  context: IExecuteFunctions,
  configurationItemId: number,
  title: string,
  body: string,
  warnings: string[],
): Promise<number | null> {
  const endpoint = `ConfigurationItems/${configurationItemId}/Notes/`;
  const payload: IDataObject = {
    id: 0,
    title,
    description: truncateText(body),
    actionType: 1,
    publish: 1,
    configurationItemID: configurationItemId,
  };
  await applyRequiredFieldDefaults('ConfigurationItemNote', context, payload, warnings);
  const response = await autotaskApiRequest.call(context, 'POST', endpoint, payload) as IDataObject;
  return extractCreatedId(response);
}

async function listAttachments(
  context: IExecuteFunctions,
  endpoint: string,
): Promise<IDataObject[]> {
  const response = await autotaskApiRequest.call(context, 'GET', endpoint) as { items?: IDataObject[] };
  return Array.isArray(response.items) ? response.items : [];
}

async function uploadAttachmentWithPolicies(
  context: IExecuteFunctions,
  destinationEndpoint: string,
  sourceAttachmentId: number,
  binaryData: string,
  fullPath: string,
  title: string,
  publish: number,
  options: MoveConfigurationItemOptions,
  throttleState: ThrottleState,
  warnings: string[],
  skippedTarget: string[],
): Promise<number | null> {
  const bytes = Buffer.from(binaryData, 'base64').length;
  if (bytes > options.throttlePolicy.maxSingleFileBytes) {
    const descriptor = `${sourceAttachmentId} (${fullPath})`;
    if (options.attachmentOversizePolicy === 'fail') {
      throw new Error(`Attachment ${descriptor} exceeds maxSingleFileBytes (${options.throttlePolicy.maxSingleFileBytes})`);
    }
    skippedTarget.push(descriptor);
    warnings.push(`Skipped oversize attachment ${descriptor}`);
    return null;
  }

  await throttleForUpload(throttleState, bytes, options.throttlePolicy);
  const payload: IDataObject = {
    id: 0,
    attachmentType: ATTACHMENT_TYPE,
    data: binaryData,
    fullPath,
    title,
    publish,
  };

  const response = await withRetries(
    async () => autotaskApiRequest.call(context, 'POST', destinationEndpoint, payload) as Promise<IDataObject>,
    options.retryPolicy,
  );
  throttleState.uploads.push({ timestampMs: Date.now(), bytes });
  return extractCreatedId(response);
}

function elapsedMs(startMs: number): number {
  return Math.max(0, Date.now() - startMs);
}

export async function executeMoveConfigurationItem(
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<IDataObject> {
  const runStartMs = Date.now();
  const phaseStartMs = {
    preflight: Date.now(),
    create: 0,
    copyAttachments: 0,
    copyNotes: 0,
    copyNoteAttachments: 0,
    auditNotes: 0,
    deactivateSource: 0,
  };

  const options = parseCopyOptions(context, itemIndex);
  const runId = options.idempotencyKey ?? `ci-move-${options.sourceConfigurationItemId}-${Date.now()}`;
  const warnings: string[] = [];
  const skipped: SkippedCollections = { udfs: [], attachments: [], noteAttachments: [] };
  const mappings: MigrationMappings = { notes: {}, attachments: {}, noteAttachments: {} };
  const counters: MigrationCounters = { notesCopied: 0, attachmentsCopied: 0, noteAttachmentsCopied: 0 };
  const throttleState: ThrottleState = { uploads: [] };

  let sourceCi: IDataObject | null = null;
  let sourceCompanyId = 0;
  let destinationCiId: number | null = null;
  let auditNotesCreated = false;
  let sourceDeactivated = false;

  let leftBehindCounts: IDataObject = {};
  let sourceNotes: IDataObject[] = [];
  let sourceCiAttachments: IDataObject[] = [];

  try {
    sourceCi = await fetchEntityById(
      context,
      `ConfigurationItems/${options.sourceConfigurationItemId}/`,
      `Source configuration item ${options.sourceConfigurationItemId} was not found`,
    );
    const sourceCompanyRaw = sourceCi.companyID;
    sourceCompanyId = typeof sourceCompanyRaw === 'number'
      ? sourceCompanyRaw
      : Number.parseInt(String(sourceCompanyRaw ?? ''), 10);
    if (!Number.isInteger(sourceCompanyId) || sourceCompanyId < 0) {
      throw new Error(
        `Source configuration item has an invalid companyID (raw value: ${JSON.stringify(sourceCompanyRaw)}, type: ${typeof sourceCompanyRaw})`,
      );
    }

    await fetchEntityById(
      context,
      `Companies/${options.destinationCompanyId}/`,
      `Destination company ${options.destinationCompanyId} was not found`,
    );

    if (options.destinationCompanyLocationId !== null) {
      const location = await fetchEntityById(
        context,
        `CompanyLocations/${options.destinationCompanyLocationId}/`,
        `Destination location ${options.destinationCompanyLocationId} was not found`,
      );
      const locationCompanyId = Number.parseInt(String(location.companyID ?? 0), 10);
      if (locationCompanyId !== options.destinationCompanyId) {
        throw new Error(
          `Destination location ${options.destinationCompanyLocationId} does not belong to destination company ${options.destinationCompanyId}`,
        );
      }
    }

    if (options.destinationContactId !== null) {
      const contact = await fetchEntityById(
        context,
        `Contacts/${options.destinationContactId}/`,
        `Destination contact ${options.destinationContactId} was not found`,
      );
      const isActive = contact.isActive === true || contact.isActive === 1;
      if (!isActive) {
        warnings.push(`Destination contact ${options.destinationContactId} is inactive; will be temporarily activated during CI creation.`);
      }
      const contactCompanyId = Number.parseInt(String(contact.companyID ?? 0), 10);
      const parentCompanyId = Number.parseInt(String(contact.parentCompanyID ?? 0), 10);
      const contactMatchesDestination = contactCompanyId === options.destinationCompanyId || parentCompanyId === options.destinationCompanyId;
      if (!contactMatchesDestination) {
        throw new Error(
          `Destination contact ${options.destinationContactId} is not linked to destination company ${options.destinationCompanyId}`,
        );
      }
    } else {
      warnings.push('destinationContactId not provided; destination contact linkage will be cleared.');
    }

    const sourceIsInactive = sourceCi.isActive === 0 || sourceCi.isActive === false;
    if (sourceIsInactive) {
      warnings.push(`Source configuration item ${options.sourceConfigurationItemId} is already inactive.`);
    }

    const noteCount = await queryCount(context, 'ConfigurationItemNotes/query/count', [
      { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
    ]);
    const ciAttachmentCount = await queryCount(context, 'ConfigurationItemAttachments/query/count', [
      { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
    ]);
    leftBehindCounts = {
      ticketAdditionalConfigurationItems: await queryCount(context, 'TicketAdditionalConfigurationItems/query/count', [
        { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
      ]),
      configurationItemRelatedItems: await queryCount(context, 'ConfigurationItemRelatedItems/query/count', [
        { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
      ]),
      // NOTE: ConfigurationItemDnsRecords cannot be counted reliably —
      // the entity has no queryable configurationItemID field, and the
      // parent-scoped URL 404s for non-DNS configuration items.
      configurationItemBillingProductAssociations: await queryCount(context, 'ConfigurationItemBillingProductAssociations/query/count', [
        { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
      ]),
      configurationItemSslSubjectAlternativeNames: await queryCount(context, 'ConfigurationItemSslSubjectAlternativeNames/query/count', [
        { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
      ]),
      sourceNotes: noteCount,
      sourceAttachments: ciAttachmentCount,
    };

    sourceNotes = options.copyNotes
      ? await queryAll(context, 'ConfigurationItemNotes/query', [
        { field: 'configurationItemID', op: 'eq', value: options.sourceConfigurationItemId },
      ])
      : [];
    sourceNotes.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));

    sourceCiAttachments = options.copyAttachments
      ? await listAttachments(context, `ConfigurationItems/${options.sourceConfigurationItemId}/Attachments/`)
      : [];
  } finally {
    const preflightMs = elapsedMs(phaseStartMs.preflight);
    phaseStartMs.create = Date.now();
    phaseStartMs.preflight = preflightMs;
  }

  if (!sourceCi) {
    throw new Error('Failed to load source configuration item');
  }

  const writableFields = await getWritableFieldNames('ConfigurationItem', context);
  const noteWritableFields = await getWritableFieldNames('ConfigurationItemNote', context);
  const destinationPayload = buildDestinationCiPayload(sourceCi, options, writableFields, skipped.udfs, warnings);
  if (options.dryRun) {
    const summary = {
      runId,
      dryRun: true,
      sourceConfigurationItemId: options.sourceConfigurationItemId,
      destinationCompanyId: options.destinationCompanyId,
      destinationCompanyLocationId: options.destinationCompanyLocationId,
      destinationContactId: options.destinationContactId,
      payload: destinationPayload,
      preflight: {
        sourceCompanyId,
        sourceReferenceTitle: sourceCi.referenceTitle ?? null,
        sourceSerialNumber: sourceCi.serialNumber ?? null,
        leftBehindCounts,
      },
      plannedCounts: {
        notesToCopy: sourceNotes.length,
        attachmentsToCopy: sourceCiAttachments.length,
      },
      status: {
        warnings,
        skipped,
      },
    };
    return summary as IDataObject;
  }

  try {
    destinationCiId = await createCiWithReferenceFieldFallback(
      context,
      destinationPayload,
      warnings,
    );

    const createdCi = await fetchEntityById(
      context,
      `ConfigurationItems/${destinationCiId}/`,
      `Destination configuration item ${destinationCiId} was not found after create`,
    );
    const createdCompanyId = Number.parseInt(String(createdCi.companyID ?? 0), 10);
    if (createdCompanyId !== options.destinationCompanyId) {
      throw new Error(`Post-create verification failed: destination CI companyID is ${createdCompanyId}`);
    }
    const createMs = elapsedMs(phaseStartMs.create);
    phaseStartMs.copyAttachments = Date.now();
    phaseStartMs.create = createMs;

    if (options.copyAttachments) {
      for (const sourceAttachment of sourceCiAttachments) {
        const sourceAttachmentId = Number(sourceAttachment.id ?? 0);
        if (!Number.isInteger(sourceAttachmentId) || sourceAttachmentId <= 0) {
          continue;
        }
        const attachmentDetail = await withRetries(
          async () => autotaskApiRequest.call(
            context,
            'GET',
            `ConfigurationItems/${options.sourceConfigurationItemId}/Attachments/${sourceAttachmentId}/`,
          ) as Promise<{ items?: IDataObject[] }>,
          options.retryPolicy,
        );
        const attachment = attachmentDetail.items?.[0];
        if (!attachment || typeof attachment.data !== 'string' || attachment.data.trim() === '') {
          warnings.push(`Attachment ${sourceAttachmentId} has no data and was skipped`);
          skipped.attachments.push(String(sourceAttachmentId));
          continue;
        }
        const uploadedId = await uploadAttachmentWithPolicies(
          context,
          `ConfigurationItems/${destinationCiId}/Attachments/`,
          sourceAttachmentId,
          attachment.data,
          String(attachment.fullPath ?? `attachment-${sourceAttachmentId}`),
          String(attachment.title ?? attachment.fullPath ?? `attachment-${sourceAttachmentId}`),
          Number(attachment.publish ?? 1),
          options,
          throttleState,
          warnings,
          skipped.attachments,
        );
        if (uploadedId !== null) {
          mappings.attachments[String(sourceAttachmentId)] = uploadedId;
          counters.attachmentsCopied += 1;
        }
      }
    }
    const copyAttachmentsMs = elapsedMs(phaseStartMs.copyAttachments);
    phaseStartMs.copyNotes = Date.now();
    phaseStartMs.copyAttachments = copyAttachmentsMs;

    const noteAttachmentsPending: Array<{ sourceNoteId: number; destinationNoteId: number }> = [];
    if (options.copyNotes) {
      for (const sourceNote of sourceNotes) {
        const sourceNoteId = Number(sourceNote.id ?? 0);
        if (!Number.isInteger(sourceNoteId) || sourceNoteId <= 0) continue;

        const sourceNoteBody = readNoteDescription(sourceNote);
        const migratedBody = truncateText(`${buildMigrationHeader(options.sourceConfigurationItemId, sourceCompanyId)}\n\n${sourceNoteBody}`);
        const notePayload: IDataObject = { id: 0 };
        for (const fieldName of noteWritableFields) {
          if (fieldName === 'id') continue;
          const value = sourceNote[fieldName];
          if (value !== undefined) {
            notePayload[fieldName] = value;
          }
        }
        // Overrides for the destination note
        notePayload.configurationItemID = destinationCiId;
        notePayload.description = migratedBody;
        if (!notePayload.title) {
          notePayload.title = String(sourceNote.title ?? sourceNote.name ?? 'Migrated note');
        }
        await applyRequiredFieldDefaults('ConfigurationItemNote', context, notePayload, warnings);
        const createNoteResponse = await withRetries(
          async () => autotaskApiRequest.call(
            context,
            'POST',
            `ConfigurationItems/${destinationCiId}/Notes/`,
            notePayload,
          ) as Promise<IDataObject>,
          options.retryPolicy,
        );
        const newNoteId = extractCreatedId(createNoteResponse);
        if (newNoteId === null) {
          warnings.push(`Created destination note for source note ${sourceNoteId} but no itemId was returned`);
          continue;
        }
        mappings.notes[String(sourceNoteId)] = newNoteId;
        counters.notesCopied += 1;
        if (options.copyNoteAttachments) {
          noteAttachmentsPending.push({
            sourceNoteId,
            destinationNoteId: newNoteId,
          });
        }
      }
    }
    const copyNotesMs = elapsedMs(phaseStartMs.copyNotes);
    phaseStartMs.copyNoteAttachments = Date.now();
    phaseStartMs.copyNotes = copyNotesMs;

    if (options.copyNotes && options.copyNoteAttachments) {
      for (const pending of noteAttachmentsPending) {
        const sourceNoteAttachments = await listAttachments(
          context,
          `ConfigurationItemNotes/${pending.sourceNoteId}/Attachments/`,
        );
        for (const sourceAttachment of sourceNoteAttachments) {
          const sourceAttachmentId = Number(sourceAttachment.id ?? 0);
          if (!Number.isInteger(sourceAttachmentId) || sourceAttachmentId <= 0) continue;
          const attachmentDetail = await withRetries(
            async () => autotaskApiRequest.call(
              context,
              'GET',
              `ConfigurationItemNotes/${pending.sourceNoteId}/Attachments/${sourceAttachmentId}/`,
            ) as Promise<{ items?: IDataObject[] }>,
            options.retryPolicy,
          );
          const attachment = attachmentDetail.items?.[0];
          if (!attachment || typeof attachment.data !== 'string' || attachment.data.trim() === '') {
            warnings.push(`Note attachment ${sourceAttachmentId} has no data and was skipped`);
            skipped.noteAttachments.push(String(sourceAttachmentId));
            continue;
          }
          const uploadedId = await uploadAttachmentWithPolicies(
            context,
            `ConfigurationItemNotes/${pending.destinationNoteId}/Attachments/`,
            sourceAttachmentId,
            attachment.data,
            String(attachment.fullPath ?? `attachment-${sourceAttachmentId}`),
            String(attachment.title ?? attachment.fullPath ?? `attachment-${sourceAttachmentId}`),
            Number(attachment.publish ?? 1),
            options,
            throttleState,
            warnings,
            skipped.noteAttachments,
          );
          if (uploadedId !== null) {
            mappings.noteAttachments[String(sourceAttachmentId)] = uploadedId;
            counters.noteAttachmentsCopied += 1;
          }
        }
      }
    }
    const copyNoteAttachmentsMs = elapsedMs(phaseStartMs.copyNoteAttachments);
    phaseStartMs.auditNotes = Date.now();
    phaseStartMs.copyNoteAttachments = copyNoteAttachmentsMs;

    const newCiLink = await buildEntityDeepLink(context, 'configurationItem', destinationCiId) ?? '';
    const sourceCiLink = await buildEntityDeepLink(context, 'configurationItem', options.sourceConfigurationItemId) ?? '';
    if (!newCiLink || !sourceCiLink) {
      warnings.push('Deep links could not be generated — zone URL does not match the expected webservices{N}.autotask.net pattern.');
    }
    const templateVars = {
      sourceConfigurationItemId: options.sourceConfigurationItemId,
      newConfigurationItemId: destinationCiId,
      sourceCompanyId,
      destinationCompanyId: options.destinationCompanyId,
      sourceConfigurationItemLink: sourceCiLink,
      newConfigurationItemLink: newCiLink,
      runId,
      date: new Date().toISOString().split('T')[0],
    };

    let sourceAuditId: number | null = null;
    if (options.sourceAuditNote) {
      const sourceAuditBody = resolveTemplate(options.sourceAuditNote, templateVars);
      sourceAuditId = await addAuditNote(
        context,
        options.sourceConfigurationItemId,
        `CI copied to Company ${options.destinationCompanyId}`,
        sourceAuditBody,
        warnings,
      );
    }
    let destinationAuditId: number | null = null;
    if (options.destinationAuditNote) {
      const destinationAuditBody = resolveTemplate(options.destinationAuditNote, templateVars);
      destinationAuditId = await addAuditNote(
        context,
        destinationCiId,
        `CI copied from Company ${sourceCompanyId}`,
        destinationAuditBody,
        warnings,
      );
    }
    const sourceNoteOk = !options.sourceAuditNote || sourceAuditId !== null;
    const destNoteOk = !options.destinationAuditNote || destinationAuditId !== null;
    auditNotesCreated = sourceNoteOk && destNoteOk;
    if (!auditNotesCreated) {
      warnings.push('One or more audit notes could not be created.');
    }
    const auditNotesMs = elapsedMs(phaseStartMs.auditNotes);
    phaseStartMs.deactivateSource = Date.now();
    phaseStartMs.auditNotes = auditNotesMs;

    if (options.deactivateSource && auditNotesCreated) {
      await autotaskApiRequest.call(context, 'PATCH', 'ConfigurationItems/', {
        id: options.sourceConfigurationItemId,
        isActive: 0,
      });
      sourceDeactivated = true;
    } else if (options.deactivateSource && !auditNotesCreated) {
      warnings.push('Source CI deactivation skipped because audit notes were not fully created.');
    }

    const deactivateSourceMs = elapsedMs(phaseStartMs.deactivateSource);
    phaseStartMs.deactivateSource = deactivateSourceMs;
  } catch (error) {
    if (destinationCiId !== null) {
      const partialMessage = `Partial migration run ${runId}: ${error instanceof Error ? error.message : String(error)}`;
      try {
        if (options.partialFailureStrategy === 'deactivateDestination') {
          await autotaskApiRequest.call(context, 'PATCH', 'ConfigurationItems/', {
            id: destinationCiId,
            isActive: 0,
          });
          warnings.push(`Destination CI ${destinationCiId} was deactivated due to partial migration failure.`);
        }
        await addAuditNote(
          context,
          destinationCiId,
          'Partial migration',
          partialMessage,
          warnings,
        );
      } catch (partialError) {
        warnings.push(`Failed to apply partial failure strategy: ${partialError instanceof Error ? partialError.message : String(partialError)}`);
      }
    }
    throw error;
  }

  const latency: LatencyPerPhase = {
    preflightMs: Number(phaseStartMs.preflight) || 0,
    createMs: Number(phaseStartMs.create) || 0,
    copyAttachmentsMs: Number(phaseStartMs.copyAttachments) || 0,
    copyNotesMs: Number(phaseStartMs.copyNotes) || 0,
    copyNoteAttachmentsMs: Number(phaseStartMs.copyNoteAttachments) || 0,
    auditNotesMs: Number(phaseStartMs.auditNotes) || 0,
    deactivateSourceMs: Number(phaseStartMs.deactivateSource) || 0,
    totalMs: elapsedMs(runStartMs),
  };

  const status: MigrationStatus = {
    warnings,
    skipped,
    sourceDeactivated,
    auditNotesCreated,
  };

  return {
    runId,
    sourceConfigurationItemId: options.sourceConfigurationItemId,
    sourceCompanyId,
    destinationCompanyId: options.destinationCompanyId,
    newConfigurationItemId: destinationCiId,
    mapping: mappings as unknown as IDataObject,
    counters: counters as unknown as IDataObject,
    status: status as unknown as IDataObject,
    preflight: {
      leftBehindCounts,
      sourceReferenceTitle: sourceCi.referenceTitle ?? null,
      sourceSerialNumber: sourceCi.serialNumber ?? null,
      sourceIsActive: !(sourceCi.isActive === 0 || sourceCi.isActive === false),
    },
    latencyPerPhase: latency as unknown as IDataObject,
  };
}
