import type { IDataObject } from 'n8n-workflow';

export interface IAutotaskResponse<T = IDataObject> {
	items?: T[];
	item?: T;
	pageDetails?: IPageDetails;
	error?: IApiError;
	response?: T;
}

export interface IPageDetails {
	count: number;
	requestCount: number;
	prevPageUrl?: string;
	nextPageUrl?: string;
}

/**
 * API error details
 */
export interface IApiErrorDetail {
	message: string;
	code?: string;
	field?: string;
}

/**
 * API error response
 */
export interface IApiError {
	errors?: IApiErrorDetail[];
	message?: string;
	code?: string;
	name?: string;
}

/**
 * API response structure
 */
export interface IApiResponse {
	status: number;
	data?: {
		errors?: IApiErrorDetail[];
		[key: string]: unknown;
	};
}

/**
 * Extended Error type with API response
 */
export interface IApiErrorWithResponse extends Error {
	response?: IApiResponse;
	name: string;
}

export interface IApiQueryParams {
	search?: string;
	filter?: string;
	expand?: string;
	fields?: string;
	pageSize?: number;
	page?: number;
}
