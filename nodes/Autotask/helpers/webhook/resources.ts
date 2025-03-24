import type { ILoadOptionsFunctions, IHookFunctions, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl, validateEntityType } from './urls';
import { handleErrors } from '../errorHandler';
import { IBatchOptions, IBatchResult } from './batchTypes';

/**
 * Interface for resource (user) data
 */
export interface IResource {
	id: number;
	name: string;
}

/**
 * Interface for resource query options
 */
export interface IResourceQueryOptions {
	/**
	 * Maximum number of resources to retrieve per page (max: 500)
	 */
	maxRecords?: number;
	/**
	 * Whether to include inactive resources (default: false)
	 */
	includeInactive?: boolean;
	/**
	 * Specific entity type to get resources for (default: general resources)
	 */
	entityType?: string;
}

/**
 * Retrieves Autotask resources (users) that can be excluded from webhook triggers
 * Supports pagination to handle large resource sets
 *
 * @param options Query options to control resource retrieval
 * @returns Promise resolving to an array of resources
 */
export async function getResourcesForExclusion(
	this: ILoadOptionsFunctions | IHookFunctions | IExecuteFunctions,
	options: IResourceQueryOptions = {},
): Promise<IResource[]> {
	try {
		return await handleErrors(this as unknown as IExecuteFunctions, async () => {
			const { maxRecords = 500, includeInactive = false, entityType } = options;

			// Validate entity type if provided
			if (entityType) {
				validateEntityType(entityType, false, 'getResourcesForExclusion');
			}

			// Use direct endpoint approach to avoid double processing of query path
			const endpoint = 'Resources/query';

			// Create the query body with filter for resources
			const queryBody: {
				filter: Array<{
					op: string;
					items: Array<{
						op: string;
						field: string;
						value: boolean | null;
					}>;
				}>;
				maxRecords: number;
				pageIndex?: number;
			} = {
				filter: [
					{
						op: 'and',
						items: [
							{
								op: 'eq',
								field: 'isActive',
								value: includeInactive ? null : true
							}
						]
					}
				],
				maxRecords: Math.min(Math.max(1, maxRecords), 500) // Ensure maxRecords is between 1 and 500
			};

			const allResources: IResource[] = [];
			let pageIndex = 0;
			let hasMoreRecords = true;

			// Paginate through results
			while (hasMoreRecords) {
				// Add pagination parameter for pages after the first
				if (pageIndex > 0) {
					queryBody.pageIndex = pageIndex;
				}

				// Query Autotask for resources (users) using POST
				const response = await autotaskApiRequest.call(
					this,
					'POST',
					buildWebhookUrl(WebhookUrlType.GENERAL_QUERY, { endpoint }),
					queryBody
				) as {
					items?: Array<{ id: number; firstName: string; lastName: string; email: string }>;
					pageDetails?: { count: number; requestCount: number; prevPageUrl?: string; nextPageUrl?: string };
				};

				// Format resources for display
				if (response.items && response.items.length > 0) {
					for (const item of response.items) {
						const name = [item.firstName, item.lastName].filter(Boolean).join(' ');
						allResources.push({
							id: item.id,
							name: name || item.email || `Resource ${item.id}`,
						});
					}
				}

				// Check if there are more pages
				hasMoreRecords = !!(response.pageDetails?.nextPageUrl);
				if (hasMoreRecords) {
					pageIndex++;
				}

				// Break if we've reached the maxRecords limit
				if (allResources.length >= maxRecords) {
					hasMoreRecords = false;
					// Trim to exact maxRecords if we've exceeded
					if (allResources.length > maxRecords) {
						allResources.length = maxRecords;
					}
				}
			}

			// Sort resources alphabetically by name
			allResources.sort((a, b) => a.name.localeCompare(b.name));

			return allResources;
		}, {
			operation: 'getResourcesForExclusion',
			entityType: options.entityType,
		});
	} catch (error) {
		// Errors already handled by handleErrors, return empty array for UI robustness
		console.log('Returning empty resources array after error handling');
		return [];
	}
}

/**
 * Format excluded resources for API submission
 *
 * @param resourceIds Array of resource IDs to format
 * @returns Formatted array for API submission
 *
 * @example
 * // Format resource IDs for API submission
 * const formattedResources = formatExcludedResources([123, 456, 789]);
 * // Result: [{resourceID: 123}, {resourceID: 456}, {resourceID: 789}]
 */
export function formatExcludedResources(resourceIds: number[]): Array<{ resourceID: number }> {
	return resourceIds.map(id => ({ resourceID: id }));
}

/**
 * Format excluded resources into batches for efficient API submission
 *
 * @param resourceIds Array of resource IDs to format and batch
 * @param options Batch configuration options
 * @returns Array of batched resource arrays for API submission
 *
 * @example
 * // Create batches of resource IDs (2 per batch)
 * const batches = batchResourcesForExclusion([123, 456, 789, 101], { batchSize: 2 });
 * // Result: [[{resourceID: 123}, {resourceID: 456}], [{resourceID: 789}, {resourceID: 101}]]
 */
export function batchResourcesForExclusion(
	resourceIds: number[],
	options: IBatchOptions = {},
): Array<Array<{ resourceID: number }>> {
	// Extract and apply defaults for options
	const { batchSize = 50 } = options;

	// Validate inputs
	if (!Array.isArray(resourceIds)) {
		console.error('Resource IDs must be an array');
		return [];
	}

	// Create an array of formatted resources
	const formattedResources = formatExcludedResources(resourceIds);

	// Handle empty array case
	if (formattedResources.length === 0) {
		return [];
	}

	// Split into batches
	const batches: Array<Array<{ resourceID: number }>> = [];
	for (let i = 0; i < formattedResources.length; i += batchSize) {
		batches.push(formattedResources.slice(i, i + batchSize));
	}

	return batches;
}

/**
 * Processes a batch of resources and adds them to the webhook
 * with configurable concurrency and batching
 *
 * @param context The function context
 * @param resourceIds Array of resource IDs to process
 * @param commonOptions Common options for all resources
 * @param batchOptions Batching and concurrency options
 * @returns Promise resolving to results of resource additions
 *
 * @example
 * // Process resources in batches with custom settings
 * const result = await processBatchResources(this, resourceIds,
 *   { entityType: 'Tickets', webhookId: 123 },
 *   { batchSize: 20, concurrencyLimit: 5, batchPauseMs: 1000 }
 * );
 * console.log(`Added ${result.success} resources successfully`);
 */
export async function processBatchResources(
	context: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	resourceIds: number[],
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

	// Skip processing if no resources
	if (!resourceIds.length) {
		return { success: 0, failed: 0, failedIds: [] };
	}

	try {
		return await handleErrors(context as unknown as IExecuteFunctions, async () => {
			console.log(`Processing batch of ${resourceIds.length} excluded resources with concurrency limit of ${concurrencyLimit}...`);

			// Results container
			const failedIds: number[] = [];
			const errors: Record<string, unknown>[] = [];
			let successCount = 0;

			// Format and batch resources
			const formattedResources = formatExcludedResources(resourceIds);

			// Split into batches
			const batches: Array<Array<{ resourceID: number }>> = [];
			for (let i = 0; i < formattedResources.length; i += batchSize) {
				batches.push(formattedResources.slice(i, i + batchSize));
			}

			// Process each batch
			for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
				const batch = batches[batchIndex];
				console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} resources...`);

				// Process current batch with concurrency limit
				for (let i = 0; i < batch.length; i += concurrencyLimit) {
					const chunk = batch.slice(i, i + concurrencyLimit);

					// Process each resource in the chunk concurrently
					const chunkPromises = chunk.map(resource =>
						(async () => {
							try {
								const resourceUrl = buildWebhookUrl(WebhookUrlType.WEBHOOK_RESOURCES, {
									entityType,
									parentId: webhookId,
								});

								await autotaskApiRequest.call(
									context,
									'POST',
									resourceUrl,
									{
										webhookID: webhookId,
										resourceID: resource.resourceID,
									},
								);
								return { success: true, resourceId: resource.resourceID };
							} catch (error) {
								errors.push({
									resourceId: resource.resourceID,
									error: (error as Error).message || 'Unknown error',
								});
								return { success: false, resourceId: resource.resourceID };
							}
						})()
					);

					// Wait for the current chunk to complete before processing the next chunk
					const chunkResults = await Promise.all(chunkPromises);

					// Record results
					for (const result of chunkResults) {
						if (result.success) {
							successCount++;
						} else {
							failedIds.push(result.resourceId);
						}
					}
				}

				// Add pause between batches if configured (not after the final batch)
				if (batchPauseMs > 0 && batchIndex < batches.length - 1) {
					console.log(`Pausing for ${batchPauseMs}ms before next batch...`);
					await new Promise(resolve => setTimeout(resolve, batchPauseMs));
				}
			}

			console.log(`Batch processing completed: ${successCount} resources added successfully, ${failedIds.length} failed`);

			return {
				success: successCount,
				failed: failedIds.length,
				failedIds,
				errors: errors.length > 0 ? errors : undefined,
			};
		}, {
			operation: 'processBatchResources',
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
			failed: resourceIds.length,
			failedIds: resourceIds,
			errors: [{ error: (error as Error).message || 'Unknown error' }],
		};
	}
}
