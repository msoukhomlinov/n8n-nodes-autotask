import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IRequestOptions,
	JsonObject,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { API_VERSION } from '../../constants/operations';
import { getAutotaskHeaders } from './headers';
import type {
	IRequestConfig,
	IAutotaskCredentials,
} from '../../types';
import { NodeApiError } from 'n8n-workflow';
import { plural, singular } from 'pluralize';
import { getEntityMetadata } from '../../constants/entities';
import type { IQueryResponse } from '../../types/base/entity-types';
import type { IApiError } from '../../types/base/api';
import type { OperationType } from '../../types/base/entity-types';
import { handleRateLimit } from './rateLimit';
import { API_CONSTANTS } from '../../constants/api';
import { endpointThreadTracker } from './threadLimit';

interface IAutotaskSuccessResponse {
	id?: number;
	itemId?: number;
}

interface IAutotaskError {
	response?: {
		status?: number;
		data?: IApiError | IAutotaskSuccessResponse;
	};
	message?: string;
}

interface IUrlOptions {
	parentId?: string | number;
	entityId?: string | number;
	isQuery?: boolean;
	isUdf?: boolean;
	isCount?: boolean;
	isAttachment?: boolean;
	operationType?: OperationType;
	parentChain?: Array<{
		type: string;
		id: string | number;
	}>;
}

/**
 * Checks if the endpoint is a query endpoint (including pagination)
 */
function isQueryEndpoint(endpoint: string): boolean {
	return endpoint.includes('/query/') || endpoint.endsWith('/query');
}

/**
 * Checks if the operation is a modification operation (POST, PUT, PATCH, DELETE)
 * Query endpoints are excluded even if they use POST method
 */
function isModificationOperation(method: string, endpoint: string): boolean {
	// All query operations (including pagination) are not modifications
	if (isQueryEndpoint(endpoint)) {
		return false;
	}
	const isModification = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
	return isModification;
}

/**
 * Gets error message from API error response
 */
function getErrorMessage(error: IAutotaskError): string {
	if (error.response?.status === 401) {
		return 'Authentication failed: Invalid credentials';
	}

	if (error.response?.status === 404) {
		return 'Resource not found';
	}

	// Handle API errors
	const errorData = error.response?.data as IApiError;
	if (errorData?.errors?.length) {
		return JSON.stringify(errorData);
	}

	// Handle any non-200 status as error
	if (error.response?.status && error.response.status !== 200) {
		return `Operation failed with status ${error.response.status}`;
	}

	return error.message || 'Unknown error occurred';
}

/**
 * Processes an endpoint path to ensure proper pluralization and structure
 * @param endpoint The raw endpoint path
 * @param options Additional options for URL construction
 * @returns Processed endpoint with proper pluralization and structure
 */
function processEndpointPath(endpoint: string, options: IUrlOptions = {}): string {
	// Don't process complete URLs (pagination)
	if (endpoint.startsWith('http')) {
		return endpoint;
	}

	// 1. Split and clean the path
	const parts = endpoint.replace(/^\/+/, '').split('/');

	// 2. Process each part
	const processedParts = parts.map((part) => {
		// Skip processing IDs
		if (part.match(/^\d+$/)) {
			return part;
		}

		// Try to get entity metadata using singular form
		const singularPart = singular(part);
		const metadata = getEntityMetadata(singularPart);

		// If it's a known entity, handle pluralization
		if (metadata) {
			// Don't pluralize if noPluralize is true
			return metadata.noPluralize ? singularPart : plural(singularPart);
		}

		// Return original if not an entity
		return part;
	});

	// 3. Handle special URL patterns
	if (options.isQuery && !processedParts.includes('query')) {
		processedParts.push('query');
	}
	if (options.isCount && !processedParts.includes('count')) {
		processedParts.push('count');
	} else if (options.isUdf && !processedParts.includes('entityInformation')) {
		processedParts.push('entityInformation', 'userDefinedFields');
	} else if (options.isAttachment && options.entityId) {
		processedParts.push('data');
	}

	// 4. Reconstruct the path
	return `${processedParts.join('/')}/`;
}

/**
 * Validates parent chain structure
 */
function validateParentChain(chain: Array<{ type: string; id: string | number }> | undefined): void {
	if (!chain?.length) {
		return;
	}

	for (const link of chain) {
		if (!link.type || (typeof link.id !== 'string' && typeof link.id !== 'number')) {
			throw new Error(
				'Invalid parent chain structure. Each chain link must have a type and id.',
			);
		}

		const metadata = getEntityMetadata(link.type);
		if (!metadata) {
			throw new Error(
				`Invalid parent type in chain: ${link.type}. Entity type not found in metadata.`,
			);
		}
	}
}

/**
 * Builds a URL for a standard entity endpoint
 * @param entity The entity name
 * @param options Additional options for URL construction
 * @returns Formatted entity URL
 */
function buildEntityUrl(entity: string, options: IUrlOptions = {}): string {
	const metadata = getEntityMetadata(entity);
	if (!metadata) {
		throw new Error(`Invalid entity type: ${entity}. Entity type not found in metadata.`);
	}

	// Validate parent chain if present
	validateParentChain(options.parentChain);

	// Handle attachment entities
	if (metadata.isAttachment && options.entityId) {
		return processEndpointPath(`${entity}/${options.entityId}`, { ...options, isAttachment: true });
	}

	// Handle nested resources with parent chain
	if (options.parentChain?.length) {
		const chain = options.parentChain.map(p => `${p.type}/${p.id}`).join('/');
		const endpoint = `${chain}/${entity}${options.entityId ? `/${options.entityId}` : ''}`;
		return processEndpointPath(endpoint, options);
	}

	const endpoint = options.entityId ? `${entity}/${options.entityId}` : entity;
	return processEndpointPath(endpoint, options);
}

/**
 * Builds a URL for a child entity endpoint
 * @param parent The parent entity name
 * @param child The child entity name
 * @param parentId The parent entity ID
 * @param options Additional options for URL construction
 * @returns Formatted child entity URL
 */
function buildChildEntityUrl(
	parent: string,
	child: string,
	parentId: string | number,
	options: IUrlOptions = {},
): string {
	const parentMetadata = getEntityMetadata(parent);
	if (!parentMetadata) {
		throw new Error(`Invalid parent entity type: ${parent}. Entity type not found in metadata.`);
	}

	const childMetadata = getEntityMetadata(child);
	if (!childMetadata) {
		throw new Error(`Invalid child entity type: ${child}. Entity type not found in metadata.`);
	}

	// Validate parent chain if present
	validateParentChain(options.parentChain);

	const subname = childMetadata.subname || child;

	// Handle nested resources with parent chain
	if (options.parentChain?.length) {
		const chain = options.parentChain.map(p => `${p.type}/${p.id}`).join('/');
		const endpoint = `${chain}/${subname}${options.entityId ? `/${options.entityId}` : ''}`;
		return processEndpointPath(endpoint, options);
	}

	// Handle attachment child entities
	if (childMetadata.isAttachment && options.entityId) {
		const endpoint = `${parent}/${parentId}/${subname}/${options.entityId}`;
		return processEndpointPath(endpoint, { ...options, isAttachment: true });
	}

	const endpoint = `${parent}/${parentId}/${subname}${options.entityId ? `/${options.entityId}` : ''}`;
	return processEndpointPath(endpoint, options);
}

// Export URL building functions
export { buildEntityUrl, buildChildEntityUrl };
export type { IUrlOptions };

/**
 * Fetches the current API usage threshold information from Autotask
 */
export async function fetchThresholdInformation(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
): Promise<{
	externalRequestThreshold: number;
	requestThresholdTimeframe: number;
	currentTimeframeRequestCount: number;
} | null> {
	try {
		const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
		const baseUrl = credentials.zone;
		const apiPath = `${baseUrl.replace(/\/+$/, '')}/${API_VERSION.VERSION}/`;

		const options: IRequestOptions = {
			method: 'GET' as IHttpRequestMethods,
			url: `${apiPath}ThresholdInformation`,
			headers: getAutotaskHeaders(credentials),
			json: true,
		};

		// This special request should not go through normal rate limiting
		const response = await this.helpers.request(options);

		if (response && typeof response === 'object') {
			return {
				externalRequestThreshold: response.externalRequestThreshold || 10000,
				requestThresholdTimeframe: response.requestThresholdTimeframe || 60,
				currentTimeframeRequestCount: response.currentTimeframeRequestCount || 0,
			};
		}

		return null;
	} catch (error) {
		console.error('Failed to fetch threshold information:', error);
		return null;
	}
}

/**
 * Makes an authenticated request to the Autotask API
 */
export async function autotaskApiRequest<T = JsonObject>(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	method: IRequestConfig['method'],
	endpoint: string,
	body: IRequestConfig['body'] = {},
	query: IRequestConfig['query'] = {},
): Promise<T> {
	const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
	const baseUrl = credentials.zone;

	const options: IRequestOptions = {
		method,
		headers: getAutotaskHeaders(credentials),
		qs: query,
		json: true,
	};

	// For pagination URLs, use the URL as-is and preserve the original body
	if (endpoint.startsWith('http') && endpoint.includes('/query/')) {
		options.url = endpoint;
		// For pagination requests, we must preserve the original filter criteria
		// but should not include IncludeFields as they're already in the URL
		if (body && typeof body === 'object') {
			options.body = {
				filter: body.filter || [],
			};
		}
	} else {
		// Process regular endpoints
		const apiPath = `${baseUrl.replace(/\/+$/, '')}/${API_VERSION.VERSION}/`;
		const isQueryOp = isQueryEndpoint(endpoint);
		const processedEndpoint = processEndpointPath(endpoint, { isQuery: isQueryOp });
		options.url = `${apiPath}${processedEndpoint}`;
		options.body = body;
	}

	let retryAttempt = 0;
	const maxRetries = API_CONSTANTS.MAX_RETRIES;

	// Extract the base endpoint name for thread tracking
	// This gets the root entity type (e.g., "Tickets" from "Tickets/123" or "Tickets/query")
	const baseEndpoint = endpoint.split('/')[0];

	do {
		try {
			// Acquire a thread for this endpoint before proceeding
			await endpointThreadTracker.acquireThread(baseEndpoint);

			// Handle rate limiting before making the request
			await handleRateLimit(retryAttempt);

			const response = await this.helpers.request(options);

			// Handle empty responses
			if (!response) {
				throw new Error('Empty response from API');
			}

			// Handle entity information responses first (most specific)
			if (endpoint.includes('entityInformation')) {
				// Fields response
				if (endpoint.endsWith('fields') || endpoint.endsWith('userDefinedFields')) {
					const fieldsResponse = response as { fields: unknown[] };
					if (!fieldsResponse?.fields || !Array.isArray(fieldsResponse.fields)) {
						throw new Error(`Invalid fields response: missing or invalid fields array for ${endpoint}`);
					}
					return response as T;
				}
				// Entity info response
				const infoResponse = response as { info: Record<string, unknown> };
				if (!infoResponse?.info || typeof infoResponse.info !== 'object') {
					throw new Error('Invalid entity information response: missing or invalid info object');
				}
				return response as T;
			}

			// Handle modification operations next (POST, PUT, PATCH, DELETE)
			if (isModificationOperation(method, endpoint)) {
				const modResponse = response as IAutotaskSuccessResponse;

				// For child entity operations (e.g. tasks under projects)
				if (endpoint.includes('/') && endpoint.split('/').length > 2) {
					const modResponse = response as IAutotaskSuccessResponse;
					if ('itemId' in modResponse) {
						return { item: { itemId: modResponse.itemId } } as T;
					}
				}

				// For regular entity operations
				if ('id' in modResponse || 'itemId' in modResponse) {
					const idField = 'id' in modResponse ? 'id' : 'itemId';
					return { item: { [idField]: modResponse[idField] } } as T;
				}
				throw new Error(`Invalid modification response: missing id/itemId for ${method} ${endpoint}`);
			}

			// Handle count query responses
			if (endpoint.includes('/query/count')) {
				const countResponse = response as { queryCount: number };
				if (typeof countResponse?.queryCount === 'number') {
					return response as T;
				}
				throw new Error(`Invalid count response: missing or invalid queryCount value. Response: ${JSON.stringify(response)}`);
			}

			// Handle query responses
			if (isQueryEndpoint(endpoint)) {
				const queryResponse = response as IQueryResponse<T>;
				if (queryResponse?.items && Array.isArray(queryResponse.items) && queryResponse?.pageDetails) {
					return response as T;
				}
				throw new Error('Invalid query response: missing items array or pageDetails');
			}

			// Handle single entity GET responses
			if (method === 'GET' && !isQueryEndpoint(endpoint)) {
				if (response?.item) {
					return response as T;
				}

				if (response && response.item === null) {
					// This indicates the record wasn't found but API returned a valid response
					const entityType = endpoint.split('/')[0].replace(/\/$/, '');
					const entityId = endpoint.split('/')[1]?.replace(/\/$/, '') || 'unknown';
					throw new Error(`[NotFoundError] The ${entityType} with ID ${entityId} was not found. Please verify the ID is correct and that you have permission to access this record.`);
				}
			}

			// If we get here, response format is unexpected
			throw new Error(`Invalid API response format for ${method} ${endpoint}: ${JSON.stringify(response)}`);
		} catch (error) {
			console.error('API Error:', error);
			console.error('Error Response:', error.response?.data);
			console.error('Error Status:', error.response?.status);

			const status = error.response?.status;
			const url = options.url;
			console.warn(`API ${method} ${url} failed (${status}): ${getErrorMessage(error)}`);

			// Check if we should retry
			const shouldRetry = (status === 429 || (status >= 500 && status < 600)) && retryAttempt < maxRetries;
			if (shouldRetry) {
				retryAttempt++;
				continue;
			}

			// For API errors with error messages, use AutotaskApiError
			const errorData = error.response?.data as IApiError;
			if (errorData?.errors?.length) {
				const messages = errorData.errors.map(e => e.message || '').filter(Boolean);
				error.error = {
					message: messages.join('\n'),
					status: error.response?.status,
				};
				error.statusCode = error.response?.status;
				throw new NodeApiError(this.getNode(), error);
			}

			// For other errors, throw NodeApiError with simple message
			error.error = {
				message: `Operation failed with status ${status}`,
				status: error.response?.status,
			};
			error.statusCode = error.response?.status;
			throw new NodeApiError(this.getNode(), error);
		} finally {
			// Release the thread when done (whether successful or failed)
			endpointThreadTracker.releaseThread(baseEndpoint);
		}
	} while (retryAttempt < maxRetries);

	// This line should never be reached due to the error handling above
	throw new Error('Maximum retry attempts exceeded');
}
