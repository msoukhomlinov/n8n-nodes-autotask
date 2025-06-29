import type { IHookFunctions, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl } from './urls';
import { handleErrors, isAuthenticationError } from '../errorHandler';
import type { IBatchOptions, IBatchResult } from './batchTypes';

/**
 * Interface for field configuration options
 */
interface IFieldAdditionOptions {
  entityType: string;
  webhookId: string | number;
  fieldId: number;
  isUdf: boolean;
  isDisplayAlwaysField: boolean;
  isSubscribedField: boolean;
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
 * @param maxRetries Maximum number of retry attempts for transient errors
 * @returns Promise resolving to success status with optional error information
 *
 * @example
 * // Add a field to a webhook
 * const result = await addFieldToWebhook(this, {
 *   entityType: 'Tickets',
 *   webhookId: 123,
 *   fieldId: 456,
 *   isUdf: false,
 *   isDisplayAlwaysField: true,
 *   isSubscribedField: false
 * });
 */
export async function addFieldToWebhook(
  context: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
  options: IFieldAdditionOptions,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  const { entityType, webhookId, fieldId, isUdf, isDisplayAlwaysField, isSubscribedField } = options;
  let attempts = 0;
  let lastError: Error | null = null;

  while (attempts < maxRetries) {
    try {
      const urlType = isUdf ? WebhookUrlType.WEBHOOK_UDF_FIELDS : WebhookUrlType.WEBHOOK_FIELDS;
      const url = buildWebhookUrl(urlType, { entityType, parentId: webhookId });

      const payload = {
        webhookID: webhookId,
        [isUdf ? 'udfFieldID' : 'fieldID']: fieldId,
        isDisplayAlwaysField,
        isSubscribedField,
      };

      await autotaskApiRequest.call(context, 'POST', url, payload);
      console.log(`Added ${isUdf ? 'UDF' : 'standard'} field: ${fieldId} (displayAlways=${isDisplayAlwaysField}, subscribed=${isSubscribedField})`);
      return { success: true };
    } catch (error) {
      lastError = error as Error;

      // Abort immediately on auth failures
      if (isAuthenticationError(lastError)) {
        console.error('Authentication/authorisation error – aborting retries:', lastError.message);
        break;
      }

      // Check if error is retryable (transient)
      const isRetryable =
        lastError.message.includes('timeout') ||
        lastError.message.includes('network') ||
        lastError.message.includes('429') ||
        lastError.message.includes('503');

      if (!isRetryable) {
        // Non-retryable error, break immediately
        break;
      }

      attempts++;
      if (attempts < maxRetries) {
        // Exponential backoff with jitter
        const delayMs = Math.min(1000 * (2 ** attempts) + Math.random() * 500, 10000);
        console.log(`Retrying field ${fieldId} (attempt ${attempts+1}/${maxRetries}) after ${delayMs}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries failed
  const errorMsg = `Failed to add field ${fieldId} after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`;
  console.error(errorMsg);
  return { success: false, error: errorMsg };
}

/**
 * Processes a batch of fields and adds them to the webhook
 * with configurable concurrency and batching
 *
 * @param context The function context
 * @param fields Array of fields to process
 * @param commonOptions Common options for all fields
 * @param batchOptions Batching and concurrency options
 * @returns Promise resolving to results of field additions
 *
 * @example
 * // Process fields in batches with custom settings
 * const result = await processBatchFields(this, fields,
 *   { entityType: 'Tickets', webhookId: 123 },
 *   { batchSize: 20, concurrencyLimit: 5, batchPauseMs: 1000 }
 * );
 * console.log(`Added ${result.success} fields successfully`);
 */
export async function processBatchFields(
  context: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
  fields: Array<{ fieldId: number; isDisplayAlwaysField: boolean; isSubscribedField: boolean; isUdf: boolean }>,
  commonOptions: { entityType: string; webhookId: string | number },
  batchOptions: IBatchOptions = {},
): Promise<IBatchResult> {
  const { entityType, webhookId } = commonOptions;
  const {
    concurrencyLimit = 10,
    batchSize = 50,
    batchPauseMs = 0,
    throwOnError = false,
  } = batchOptions;

  // Skip processing if no fields
  if (!fields.length) {
    return { success: 0, failed: 0, failedIds: [] };
  }

  try {
    return await handleErrors(context as unknown as IExecuteFunctions, async () => {
      console.log(`Processing batch of ${fields.length} webhook fields with concurrency limit of ${concurrencyLimit}...`);

      // Results container
      const failedIds: number[] = [];
      const errors: Record<string, unknown>[] = [];
      let successCount = 0;

      // Split fields into batches
      const batches: Array<typeof fields> = [];
      for (let i = 0; i < fields.length; i += batchSize) {
        batches.push(fields.slice(i, i + batchSize));
      }

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} fields...`);

        // Process current batch with concurrency limit
        // Create chunks within each batch for concurrency control
        for (let i = 0; i < batch.length; i += concurrencyLimit) {
          const chunk = batch.slice(i, i + concurrencyLimit);

          // Process each chunk concurrently
          const chunkPromises = chunk.map(field =>
            addFieldToWebhook(context, {
              entityType,
              webhookId,
              fieldId: field.fieldId,
              isUdf: field.isUdf,
              isDisplayAlwaysField: field.isDisplayAlwaysField,
              isSubscribedField: field.isSubscribedField,
            }, 3).then(result => {
              if (!result.success) {
                errors.push({
                  fieldId: field.fieldId,
                  error: result.error || 'Unknown error',
                });
                return { success: false, fieldId: field.fieldId };
              }
              return { success: true, fieldId: field.fieldId };
            }).catch(error => {
              errors.push({
                fieldId: field.fieldId,
                error: error.message || 'Unknown error',
              });
              return { success: false, fieldId: field.fieldId };
            })
          );

          // Wait for the current chunk to complete before processing the next chunk
          const chunkResults = await Promise.all(chunkPromises);

          // Record results
          for (const result of chunkResults) {
            if (result.success) {
              successCount++;
            } else {
              failedIds.push(result.fieldId);
            }
          }
        }

        // Add pause between batches if configured (not after the final batch)
        if (batchPauseMs > 0 && batchIndex < batches.length - 1) {
          console.log(`Pausing for ${batchPauseMs}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, batchPauseMs));
        }
      }

      console.log(`Batch processing completed: ${successCount} succeeded, ${failedIds.length} failed`);

      // If throwOnError is true and we have failures, throw an error
      if (throwOnError && failedIds.length > 0) {
        const errorMsg = `Failed to configure ${failedIds.length} webhook fields after retries: ${failedIds.join(', ')}`;
        throw new Error(errorMsg);
      }

      return {
        success: successCount,
        failed: failedIds.length,
        failedIds,
        errors: errors.length > 0 ? errors : undefined,
      };
    }, {
      operation: 'processBatchFields',
      entityType,
    });
  } catch (error) {
    // If the entire batch operation fails
    console.error(`Batch processing failed for ${entityType} webhook ${webhookId}`);

    if (throwOnError) {
      throw error;
    }

    return {
      success: 0,
      failed: fields.length,
      failedIds: fields.map(field => field.fieldId),
      errors: [{ error: (error as Error).message || 'Unknown error' }],
    };
  }
}
