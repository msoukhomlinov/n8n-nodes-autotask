import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const MAX_TOTAL_WAIT_MS = 300_000; // 5 minutes
const BASE_DELAY_MS = 1_000; // Start with 1 second
const MAX_DELAY_MS = 60_000; // Cap individual waits at 1 minute

type AutotaskContexts = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

/**
 * Wraps a request function with automatic retry logic for 429 rate limit errors.
 * Uses exponential backoff with jitter to naturally spread retry attempts.
 */
export async function executeWithRetry<T>(
	context: AutotaskContexts,
	requestFn: () => Promise<T>,
): Promise<T> {
	let attempt = 0;
	let totalWaitTime = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			return await requestFn();
		} catch (error: unknown) {
			const err = error as { response?: { status?: number; headers?: Record<string, string> } };
			const status = err.response?.status;

			// Only retry 429s - throw other errors immediately
			if (status !== 429) {
				throw error;
			}

			attempt += 1;

			// Parse Retry-After header if present
			const retryAfter = err.response?.headers?.['retry-after'];
			let waitMs: number;

			if (retryAfter) {
				const parsed = Number.parseInt(retryAfter, 10);
				waitMs = Number.isNaN(parsed) ? 60_000 : Math.min(parsed * 1_000, MAX_DELAY_MS);
			} else {
				// Exponential backoff with jitter (+/-25%)
				const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
				const jitterRange = backoff * 0.25;
				const jitter = Math.random() * jitterRange * 2 - jitterRange;
				waitMs = Math.max(1_000, backoff + jitter);
			}

			totalWaitTime += waitMs;

			// Check if exceeded total wait time
			if (totalWaitTime >= MAX_TOTAL_WAIT_MS) {
				const rateLimitError = {
					message:
						'Autotask API rate limit exceeded (429 Too Many Requests). ' +
						`Retried ${attempt} times over ${(totalWaitTime / 1_000).toFixed(0)} seconds, ` +
						'but the limit persists. This indicates sustained high API usage. ' +
						'Suggestions: ' +
						'(1) Reduce workflow trigger frequency or concurrency. ' +
						'(2) Enable response caching on read operations to reduce API calls. ' +
						'(3) Spread bulk operations over a longer time period. ' +
						'(4) Consider that other n8n instances or integrations may be consuming the API quota.',
					statusCode: 429,
					description:
						'Rate limit exceeded after ' +
						`${attempt} retry attempts ` +
						`(${(totalWaitTime / 1_000).toFixed(0)}s total wait).`,
				};

				throw new NodeApiError(context.getNode(), rateLimitError);
			}

			// Log and wait before retry
			// eslint-disable-next-line no-console
			console.warn(
				`[429 Retry] Attempt ${attempt}, waiting ${(waitMs / 1_000).toFixed(
					1,
				)}s (total wait: ${(totalWaitTime / 1_000).toFixed(0)}s / ${
					MAX_TOTAL_WAIT_MS / 1_000
				}s)`,
			);

			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}
}

