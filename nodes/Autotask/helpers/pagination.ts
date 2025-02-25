import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions } from 'n8n-workflow';
import type { IPageDetails } from '../types/base/entity-types';
import type { IQueryResponse } from '../types/base/entity-types';
import { PAGINATION } from '../constants';
import { handleErrors } from './errorHandler';

/**
 * Handles pagination state and response processing for Autotask API requests
 * Supports tracking up to 50 pages of results and handles the 500 record limit per page
 */
export class PaginationHandler {
	private state: IPaginationState;
	private readonly context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

	constructor(
		private readonly entityType: string,
		context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
		options?: {
			pageSize?: number;
			maxPages?: number;
		},
	) {
		this.context = context;
		this.state = {
			currentPage: 0,
			totalPages: 0,
			pageSize: options?.pageSize || PAGINATION.DEFAULT_PAGE_SIZE,
			hasNextPage: false,
			nextPageUrl: null,
		};
	}

	/**
	 * Updates pagination state based on API response
	 */
	public updateState(pageDetails: IPageDetails): void {
		this.state = {
			...this.state,
			currentPage: this.state.currentPage + 1,
			totalPages: Math.ceil(pageDetails.requestCount / this.state.pageSize),
			hasNextPage: !!pageDetails.nextPageUrl,
			nextPageUrl: pageDetails.nextPageUrl || null,
		};
	}

	/**
	 * Processes API response and updates pagination state
	 */
	public async processResponse<T>(response: IQueryResponse<T>): Promise<T[]> {
		return await handleErrors(this.context as IExecuteFunctions, async () => {
			if (!response.items || !Array.isArray(response.items)) {
				throw new Error(`Invalid response format for ${this.entityType}: Missing or invalid items array`);
			}

			if (response.pageDetails) {
				this.updateState(response.pageDetails);
			}

			return response.items;
		});
	}

	/**
	 * Gets the current pagination state
	 */
	public getState(): IPaginationState {
		return { ...this.state };
	}

	/**
	 * Checks if there are more pages available
	 */
	public hasNextPage(): boolean {
		return this.state.hasNextPage && this.state.currentPage < PAGINATION.MAX_PAGES;
	}

	/**
	 * Gets the URL for the next page of results
	 */
	public getNextPageUrl(): string | null {
		return this.hasNextPage() ? this.state.nextPageUrl : null;
	}

	/**
	 * Resets the pagination state
	 */
	public reset(): void {
		this.state = {
			currentPage: 0,
			totalPages: 0,
			pageSize: this.state.pageSize,
			hasNextPage: false,
			nextPageUrl: null,
		};
	}
}

/**
 * Internal state for tracking pagination
 */
interface IPaginationState {
	currentPage: number;
	totalPages: number;
	pageSize: number;
	hasNextPage: boolean;
	nextPageUrl: string | null;
}
