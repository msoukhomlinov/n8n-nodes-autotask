import type { IHookFunctions, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl } from './urls';

/**
 * Interface for field configuration options
 */
interface IFieldAdditionOptions {
  entityType: string;
  webhookId: string | number;
  fieldId: number;
  isUdf: boolean;
  isDisplayAlwaysField: boolean;
}

/**
 * Interface for batch processing results
 */
interface IBatchProcessingResult {
  success: number;
  failed: number;
  failedIds: number[];
}

/**
 * Normalizes a field ID to ensure consistent handling
 * @param fieldId Field ID in string or number format
 * @returns Normalized field ID as number
 */
export function normalizeFieldId(fieldId: string | number): number {
  if (typeof fieldId === 'string') {
    return Number.parseInt(fieldId, 10);
  }
  return fieldId;
}

/**
 * Adds a field to a webhook with appropriate configuration
 * @param context The function context (IHookFunctions, IExecuteFunctions, etc.)
 * @param options Field addition options
 * @returns Promise resolving to success status
 */
export async function addFieldToWebhook(
  context: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
  options: IFieldAdditionOptions
): Promise<boolean> {
  const { entityType, webhookId, fieldId, isUdf, isDisplayAlwaysField } = options;

  try {
    const urlType = isUdf ? WebhookUrlType.WEBHOOK_UDF_FIELDS : WebhookUrlType.WEBHOOK_FIELDS;
    const url = buildWebhookUrl(urlType, { entityType, parentId: webhookId });

    const payload = {
      webhookID: webhookId,
      [isUdf ? 'udfFieldID' : 'fieldID']: fieldId,
      isDisplayAlwaysField,
      isSubscribedField: !isDisplayAlwaysField,
    };

    await autotaskApiRequest.call(context, 'POST', url, payload);
    console.log(`Added ${isUdf ? 'UDF' : 'standard'} field: ${fieldId} (displayAlways=${isDisplayAlwaysField})`);
    return true;
  } catch (error) {
    console.error(`Error adding ${isUdf ? 'UDF' : 'standard'} field ${fieldId} to webhook:`, error);
    console.error(`Error details: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Processes a batch of fields and adds them to the webhook
 * with a concurrency limit
 * @param context The function context
 * @param fields Array of fields to process
 * @param options Common options for all fields
 * @param concurrencyLimit Maximum number of concurrent requests (default: 10)
 * @returns Promise resolving to results of field additions
 */
export async function processBatchFields(
  context: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
  fields: Array<{ fieldId: number; isDisplayAlwaysField: boolean; isUdf: boolean }>,
  options: { entityType: string; webhookId: string | number },
  concurrencyLimit = 10
): Promise<IBatchProcessingResult> {
  const { entityType, webhookId } = options;

  // Skip processing if no fields
  if (!fields.length) {
    return {
      success: 0,
      failed: 0,
      failedIds: [],
    };
  }

  console.log(`Processing batch of ${fields.length} webhook fields with concurrency limit of ${concurrencyLimit}...`);

  // Results container
  const results: boolean[] = [];
  const failedIds: number[] = [];
  let successCount = 0;

  // Process fields in chunks respecting the concurrency limit
  for (let i = 0; i < fields.length; i += concurrencyLimit) {
    const chunk = fields.slice(i, i + concurrencyLimit);
    console.log(`Processing chunk ${i / concurrencyLimit + 1} with ${chunk.length} fields...`);

    // Process current chunk concurrently
    const chunkResults = await Promise.all(
      chunk.map(field =>
        addFieldToWebhook(context, {
          entityType,
          webhookId,
          fieldId: field.fieldId,
          isUdf: field.isUdf,
          isDisplayAlwaysField: field.isDisplayAlwaysField,
        })
      )
    );

    // Record results from this chunk
    results.push(...chunkResults);
  }

  // Calculate final statistics
  results.forEach((succeeded, index) => {
    if (succeeded) {
      successCount++;
    } else {
      failedIds.push(fields[index].fieldId);
    }
  });

  console.log(`Batch processing completed: ${successCount} succeeded, ${failedIds.length} failed`);

  return {
    success: successCount,
    failed: failedIds.length,
    failedIds,
  };
}
