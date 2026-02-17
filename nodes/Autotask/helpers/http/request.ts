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
import { isImpersonationSupportedForEndpoint } from '../impersonation';
import type { IRequestConfig, IAutotaskCredentials } from '../../types';
import { NodeApiError } from 'n8n-workflow';
import { plural, singular } from 'pluralize';
import { getEntityMetadata } from '../../constants/entities';
import type { IQueryResponse } from '../../types/base/entity-types';
import type { IApiError, IApiErrorDetail, IApiErrorWithResponse } from '../../types/base/api';
import type { OperationType } from '../../types/base/entity-types';
import { handleRateLimit } from './rateLimit';
import { endpointThreadTracker } from './threadLimit';
import { executeWithRetry } from './retryHandler';

interface IAutotaskSuccessResponse {
	id?: number;
	itemId?: number;
}

// Rename to avoid conflict with imported interface
interface IAutotaskErrorResponse {
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
function getErrorMessage(error: IAutotaskErrorResponse): string {
	if (error.response?.status === 401) {
		return 'Authentication failed: Invalid credentials';
	}

	if (error.response?.status === 404) {
		return 'Resource not found';
	}

	// Handle API errors with detailed information
	const errorData = error.response?.data as IApiError;
	if (errorData?.errors?.length) {
		// Format errors using our standard format
		return formatErrorDetails(errorData.errors);
	}

	// Handle any non-200 status as error
	if (error.response?.status && error.response.status !== 200) {
		return `Operation failed with status ${error.response.status}${error.message ? `: ${error.message}` : ''}`;
	}

	return error.message || 'Unknown error occurred';
}

/**
 * Formats error details with consistent pattern
 * @internal
 */
function formatErrorDetails(errors: IApiErrorDetail[]): string {
	if (!errors?.length) return 'Unknown error occurred';

	return errors.map(e => {
		let message = e.message || 'Unknown error';
		if (e.field) {
			message = `Field '${e.field}': ${message}`;
		}
		if (e.code) {
			message = `[${e.code}] ${message}`;
		}
		return message;
	}).join(' | ');
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

	// 1. Split and clean the path (strip leading and trailing slashes to be idempotent)
	const parts = endpoint.replace(/^\/+/, '').replace(/\/+$/, '').split('/');

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
 *
 * This function intentionally bypasses the rate limiter to avoid a circular dependency:
 * - The rate limiter needs threshold info to know if it should throttle
 * - Getting threshold info requires making an API call
 * - Making an API call would trigger the rate limiter
 * - This creates an infinite loop
 *
 * However, per Autotask API documentation, this call IS counted in the total request count:
 * https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm
 *
 * The response includes the current count which already reflects this call, so our
 * rate tracker syncs with the actual count from the API.
 *
 * @returns Threshold information including current usage, or null if the request fails
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
		const baseUrl = credentials.zone === 'other' ? credentials.customZoneUrl || '' : credentials.zone;
		const apiPath = `${baseUrl.replace(/\/+$/, '')}/${API_VERSION.VERSION}/`;

		const options: IRequestOptions = {
			method: 'GET' as IHttpRequestMethods,
			url: `${apiPath}ThresholdInformation`,
			headers: getAutotaskHeaders(credentials),
			json: true,
		};

		// Bypass rate limiter to avoid circular dependency (see function documentation above)
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
		// Import sanitization function to mask credentials in error logs
		const { sanitizeErrorForLogging } = await import('../security/credential-masking');
		console.error('Failed to fetch threshold information:', sanitizeErrorForLogging(error));
		return null;
	}
}

/**
 * Makes an authenticated request to the Autotask API
 *
 * @param impersonationResourceId - Optional resource ID for impersonation. When set, the
 *   ImpersonationResourceId header is sent so created records are attributed to that resource.
 * @param proceedWithoutImpersonationIfDenied - When true, retries once without impersonation
 *   if the impersonated call is denied with an "adequate permissions" error.
 */
export async function autotaskApiRequest<T = JsonObject>(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	method: IRequestConfig['method'],
	endpoint: string,
	body: IRequestConfig['body'] = {},
	query: IRequestConfig['query'] = {},
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied = true,
): Promise<T> {
	const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials | undefined;
	if (!credentials) {
		throw new Error(
			'Autotask API credentials not found. Ensure the node has valid Autotask API credentials configured.',
		);
	}
	const baseUrl = credentials.zone === 'other' ? credentials.customZoneUrl || '' : credentials.zone;
	if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim()) {
		throw new Error(
			'Autotask API zone URL is missing. Check credentials: select a zone, or if using "Other (Custom URL)", provide the custom zone URL.',
		);
	}

	// Guard: only apply impersonation to endpoints that Autotask supports
	let effectiveImpersonation = impersonationResourceId;
	if (effectiveImpersonation !== undefined && !isImpersonationSupportedForEndpoint(endpoint)) {
		console.warn(
			`[autotaskApiRequest] Impersonation requested (resource ${effectiveImpersonation}) but endpoint "${endpoint}" is not in the Autotask impersonation-supported entity list. Header will be omitted for this call.`,
		);
		effectiveImpersonation = undefined;
	}

	const options: IRequestOptions = {
		method,
		headers: getAutotaskHeaders(credentials, effectiveImpersonation),
		qs: query,
		json: true,
	};

	// For pagination URLs, use the URL as-is and preserve the original body
	if (endpoint.startsWith('http') && endpoint.includes('/query/')) {
		// Check if using custom URL
		if (credentials.zone === 'other' && credentials.customZoneUrl) {
			// Extract the path from the endpoint URL (everything after the domain)
			const urlObj = new URL(endpoint);
			const pathWithQuery = urlObj.pathname + urlObj.search;

			// Combine custom URL with the extracted path
			const customBaseUrl = credentials.customZoneUrl.replace(/\/+$/, '');
			options.url = `${customBaseUrl}${pathWithQuery}`;
		} else {
			// Standard behavior - use the full URL as-is
			options.url = endpoint;
		}

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

	// Extract the base endpoint name for thread tracking
	// This gets the root entity type (e.g., "Tickets" from "Tickets/123" or "Tickets/query")
	const baseEndpoint = endpoint.split('/')[0];

	// Validate URL before request (helps diagnose ERR_INVALID_URL in AI Agent context)
	try {
		new URL(options.url as string);
	} catch (urlError) {
		const msg = urlError instanceof Error ? urlError.message : String(urlError);
		throw new Error(
			`Invalid Autotask API URL: ${msg}. ` +
				`Constructed URL: "${options.url}", endpoint: "${endpoint}", ` +
				`zone: "${credentials.zone}", baseUrl length: ${baseUrl.length}. ` +
				`If using AI Agent, ensure credentials are correctly configured.`,
		);
	}

	try {
		// Acquire a thread for this endpoint before proceeding
		await endpointThreadTracker.acquireThread(baseEndpoint);

		// Handle rate limiting before making the request (single attempt)
		await handleRateLimit();

		const response = await executeWithRetry(this, async () => {
			return this.helpers.request(options);
		});

		// Handle empty responses
		if (!response) {
			throw new Error('Empty response from API');
		}

		// Handle special invoice file/markup endpoints (return raw response as-is)
		if (
			endpoint.includes('InvoicePDF') ||
			endpoint.includes('InvoiceMarkupHtml') ||
			endpoint.includes('InvoiceMarkupXML')
		) {
			return response as T;
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
			// Standard single entity response format
			if (response?.item) {
				return response as T;
			}

			// Some endpoints (like child entity GETs) return items array format
			const arrayResponse = response as IQueryResponse<T>;
			if (arrayResponse?.items && Array.isArray(arrayResponse.items)) {
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
		throw new Error(
			`Invalid API response format for ${method} ${endpoint}: ${JSON.stringify(response)}`,
		);
	} catch (error: unknown) {
		// If this is already a NodeApiError (e.g. from retry handler), re-throw as-is
		// to avoid double-wrapping the error
		if (error instanceof NodeApiError) {
			throw error;
		}

		const apiError = error as Error & {
			response?: {
				status?: number;
				data?: { errors?: unknown[]; [key: string]: unknown };
			};
			error?: { errors?: unknown[] };
			statusCode?: number;
			description?: string;
		};

		// Import sanitization function to mask credentials in error logs
		const { sanitizeErrorForLogging } = await import('../security/credential-masking');
		console.error('API Error:', sanitizeErrorForLogging(apiError));

		const status = apiError.response?.status;
		const url = options.url;
		console.warn(`API ${method} ${url} failed (${status}): ${getErrorMessage(apiError as unknown as IAutotaskErrorResponse)}`);

		// Import the createStandardErrorObject function
		const { createStandardErrorObject } = await import('../../helpers/errorHandler');

		// Create standardized error object with all context
		const standardError = createStandardErrorObject(
			apiError as Error | IApiErrorWithResponse,
			{
				url,
				method,
				status,
				// Add operation and entity context if available
				operation: endpoint.split('/')[0],
				entityType: endpoint.split('/')[0],
			},
		);

		// Extract API error messages from response
		const responseErrors = apiError.response?.data?.errors as Array<{ message?: string }> | undefined;
		const directErrors = apiError.error?.errors as Array<{ message?: string }> | undefined;
		const errorsArray = (responseErrors || directErrors || []) as Array<{ message?: string } | string>;

		// Format the error message for display with API specifics
		const apiErrorMessages =
			Array.isArray(errorsArray) && errorsArray.length > 0
				? errorsArray
						.map((e) => (typeof e === 'string' ? e : e.message))
						.filter(Boolean)
						.join(' | ')
				: '';

		// Use API specific error message if available
		let detailedMessage =
			apiErrorMessages || standardError.message || apiError.message || 'An unknown error occurred';
		const isAdequatePermissionsDenied = /does not have the adequate permissions/i.test(detailedMessage);

		// Optional fail-open mode for impersonation permission denials:
		// retry the same request once without impersonation and return that result.
		if (
			proceedWithoutImpersonationIfDenied &&
			effectiveImpersonation !== undefined &&
			isAdequatePermissionsDenied
		) {
			console.warn(
				`[autotaskApiRequest] Impersonation denied for resource ${effectiveImpersonation}; retrying ${method} ${endpoint} without impersonation.`,
			);
			return autotaskApiRequest.call(
				this,
				method,
				endpoint,
				body,
				query,
				undefined,
				false,
			) as Promise<T>;
		}

		// Enrich permissions errors with impersonation context when the header was active
		if (effectiveImpersonation !== undefined && isAdequatePermissionsDenied) {
			detailedMessage =
				`Impersonation failed (resource ${effectiveImpersonation}): ${detailedMessage}\n\n` +
				'The Autotask API executes impersonated requests under the impersonated resource\'s own security context. ' +
				'The impersonated resource must have:\n' +
				'  1. A security level that allows being impersonated\n' +
				'  2. The same entity-level permissions (Add/Edit/Delete) as if they were performing the action themselves in the Autotask UI\n' +
				'  3. Access to the specific entity sub-type (e.g. the CI type) involved\n\n' +
				'Check Admin > Account Settings & Users > Resources > Security Levels for the impersonated resource\'s security level.';
		}

		// Set consistent properties on the error object to ensure n8n displays the right message
		apiError.message = detailedMessage;
		(apiError as { description?: string }).description = detailedMessage;

		// These properties are used by n8n to display error messages in the UI
		const statusCode = standardError.statusCode ?? apiError.statusCode ?? status ?? 0;
		(apiError as { statusCode?: number }).statusCode = statusCode;
		(apiError as {
			error?: {
				message: string;
				status: number;
				context: unknown;
			};
		}).error = {
			message: detailedMessage,
			status: statusCode,
			context: standardError.context,
		};

		// Log error details (useful for debugging)
		const hasSpecificErrors = Array.isArray(errorsArray) && errorsArray.length > 0;

		console.debug('Error details:', {
			status,
			hasSpecificErrors,
			errorCount: errorsArray.length || 0,
			errorMessages: apiErrorMessages,
			responseDataErrors: responseErrors,
			errorObjectErrors: directErrors,
		});

		// Throw standardized error with the detailed message.
		// Pass message explicitly so NodeApiError.message is guaranteed to be the
		// Autotask-specific error regardless of how this n8n version's constructor
		// extracts it from the error object (behaviour varies across n8n versions).
		throw new NodeApiError(this.getNode(), apiError as unknown as JsonObject, { message: detailedMessage });
	} finally {
		// Release the thread when done (whether successful or failed)
		endpointThreadTracker.releaseThread(baseEndpoint);
	}
}
