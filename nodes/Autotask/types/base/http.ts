import type { IDataObject } from 'n8n-workflow';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface IRequestConfig {
	method: HttpMethod;
	endpoint: string;
	body?: IDataObject;
	query?: IDataObject;
	headers?: Record<string, string>;
	retryConfig?: IRetryConfig;
	impersonationId?: number;
}

export interface IRetryConfig {
	maxAttempts: number;
	baseDelay: number;
	maxDelay: number;
	backoffFactor: number;
}

export interface IZoneInfo {
	url: string;
	webUrl: string;
	dataCenter: string;
	ci: boolean;
}

export interface IRequestOptions extends IRequestConfig {
	baseURL?: string;
	skipZoneCheck?: boolean;
	validateStatus?: (status: number) => boolean;
}

export interface IHttpResponse<T = IDataObject> {
	data: T;
	headers: Record<string, string>;
	status: number;
	statusText: string;
}
