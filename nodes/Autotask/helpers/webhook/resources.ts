import type { ILoadOptionsFunctions, IHookFunctions, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from '../http';
import { WebhookUrlType, buildWebhookUrl } from './urls';
import { AutotaskWebhookEntityType } from '../../types/webhook';

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
 * Validates if the provided entity type is supported for webhooks
 * @param entityType The entity type to validate (optional)
 * @returns True if the entity type is supported or undefined
 */
function validateEntityType(entityType?: string): boolean {
	if (!entityType) return true;

	const supportedTypes = Object.values(AutotaskWebhookEntityType);
	return supportedTypes.includes(entityType as AutotaskWebhookEntityType);
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
		const { maxRecords = 500, includeInactive = false, entityType } = options;

		// Validate entity type if provided
		if (entityType && !validateEntityType(entityType)) {
			throw new Error(`Unsupported entity type: ${entityType}`);
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

			try {
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
			} catch (pageError) {
				throw new Error(`Error fetching resources page ${pageIndex}: ${(pageError as Error).message}`);
			}
		}

		// Sort resources alphabetically by name
		allResources.sort((a, b) => a.name.localeCompare(b.name));

		return allResources;
	} catch (error) {
		console.error('Error fetching resources:', error);
		// Return empty array but don't throw - this makes the UI more robust
		return [];
	}
}

/**
 * Format excluded resources for API submission
 *
 * @param resourceIds Array of resource IDs to format
 * @returns Formatted array for API submission
 */
export function formatExcludedResources(resourceIds: number[]): Array<{ resourceID: number }> {
	return resourceIds.map(id => ({ resourceID: id }));
}

/**
 * Batch-format excluded resources for efficient API submission
 * Useful when dealing with large numbers of resources
 *
 * @param resourceIds Array of resource IDs to format
 * @param batchSize Size of each batch (default: 50)
 * @returns Array of batched resource arrays for API submission
 */
export function batchFormatExcludedResources(
	resourceIds: number[],
	batchSize = 50,
): Array<Array<{ resourceID: number }>> {
	// Create an array of formatted resources
	const formattedResources = formatExcludedResources(resourceIds);

	// Split into batches
	const batches: Array<Array<{ resourceID: number }>> = [];
	for (let i = 0; i < formattedResources.length; i += batchSize) {
		batches.push(formattedResources.slice(i, i + batchSize));
	}

	return batches;
}
