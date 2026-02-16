import type { ILoadOptionsFunctions, IHookFunctions, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl, validateEntityType } from './urls';
import { handleErrors, isAuthenticationError } from '../errorHandler';
import type { IBatchOptions } from './batchTypes';
import { initializeCache } from '../cache/init';
import { API_CONSTANTS } from '../../constants/api';

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

			// Initialize cache service
			const cacheService = await initializeCache(this);
			const cacheEnabled = cacheService?.isReferenceEnabled() ?? false;

			// Create a cache key that includes the query parameters
			const cacheKeyParams = `Resources_${includeInactive ? 'all' : 'active'}_${maxRecords}`;

			// Try to get from cache first if caching is enabled
			if (cacheService && cacheEnabled) {
				const cacheKey = cacheService.getReferenceKey(cacheKeyParams);
				const cachedResources = await cacheService.get<IResource[]>(cacheKey);
				if (cachedResources) {
					console.log(`Using cached resources for exclusion (${cachedResources.length} items)`);
					return cachedResources;
				}
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
				filter: includeInactive ? [] : [
					{
						op: 'and',
						items: [
							{
								op: 'eq',
								field: 'isActive',
								value: true
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

			// Store in cache if enabled
			if (cacheService && cacheEnabled) {
				const cacheKey = cacheService.getReferenceKey(cacheKeyParams);
				await cacheService.set(cacheKey, allResources, cacheService.getReferenceFieldTTL());
				console.log(`Cached ${allResources.length} resources for exclusion`);
			}

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
 * const formattedResources = formatExcludedResources([123, 456, 789]);
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
 * const batches = batchResourcesForExclusion([123, 456, 789, 101], { batchSize: 2 });
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
 * Process a batch of resources with optimised API usage and rate limiting
 */
export async function processBatchResources<T>(
	resources: T[],
	processFunction: (resource: T) => Promise<boolean>,
	options: IBatchOptions = {},
): Promise<{ successes: number; failures: number }> {
	const {
		batchSize = API_CONSTANTS.MAX_BATCH_SIZE,
		batchPauseMs = 0,
		concurrencyLimit = API_CONSTANTS.MAX_CONCURRENT_REQUESTS,
		throwOnError = false,
		maxRetries = 3, // Default: 3 retries
		retryPauseMs = 1000, // Default: 1000ms base delay
	} = options;

	const results = {
		successes: 0,
		failures: 0,
	};

	// Process resources in batches
	for (let i = 0; i < resources.length; i += batchSize) {
		const batch = resources.slice(i, i + batchSize);
		const failedResources: T[] = [];

		// Process batch with concurrency limit
		const promises = batch.map(resource => {
			return processFunction(resource)
				.then(success => {
					if (success) {
						results.successes++;
					} else {
						failedResources.push(resource);
						results.failures++;
					}
				})
				.catch(error => {
					if (isAuthenticationError(error)) {
						console.error('Auth error – aborting further retries for this resource:', (error as Error).message);
						results.failures++;
						if (throwOnError) throw error;
						return; // stop retries for this resource
					}
					console.error('Error processing resource:', error);
					failedResources.push(resource);
					results.failures++;
					if (throwOnError) {
						throw error;
					}
				});
		});

		// Execute promises with concurrency limit
		for (let j = 0; j < promises.length; j += concurrencyLimit) {
			const batchPromises = promises.slice(j, j + concurrencyLimit);
			await Promise.all(batchPromises);

			// Add pause between concurrent batches if specified
			if (batchPauseMs > 0 && j + concurrencyLimit < promises.length) {
				await new Promise(resolve => setTimeout(resolve, batchPauseMs));
			}
		}

		// Retry failed resources with reduced concurrency
		if (failedResources.length > 0 && maxRetries > 0) {
			console.log(`Retrying ${failedResources.length} failed resources...`);

			// Reset failure count for retries
			results.failures -= failedResources.length;

			// Process retries sequentially with exponential backoff
			for (const resource of failedResources) {
				let retryAttempt = 0;
				let success = false;

				// Try up to maxRetries times for transient errors
				while (retryAttempt < maxRetries && !success) {
					try {
						// Add exponential backoff delay
						const backoffDelay = retryPauseMs * (2 ** retryAttempt);
						await new Promise(resolve => setTimeout(resolve, backoffDelay));

						success = await processFunction(resource);
						if (success) {
							results.successes++;
						} else {
							results.failures++;
							retryAttempt++;
						}
					} catch (error) {
						if (isAuthenticationError(error)) {
							console.error('Auth error during retry – aborting:', (error as Error).message);
							results.failures++;
							if (throwOnError) throw error;
							break;
						}
						console.error(`Retry attempt ${retryAttempt + 1} failed:`, error);
						retryAttempt++;
						if (retryAttempt === maxRetries) {
							results.failures++;
							if (throwOnError) {
								throw error;
							}
						}
					}
				}
			}
		}

		// Add pause between main batches if specified
		if (batchPauseMs > 0 && i + batchSize < resources.length) {
			await new Promise(resolve => setTimeout(resolve, batchPauseMs));
		}
	}

	return results;
}
