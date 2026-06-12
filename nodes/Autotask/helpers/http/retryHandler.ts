import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const MAX_TOTAL_WAIT_MS = 300_000; // 5 minutes
const BASE_DELAY_MS = 1_000; // Start with 1 second
const MAX_DELAY_MS = 60_000; // Cap exponential backoff at 1 minute
const MAX_RETRY_AFTER_MS = 600_000; // Upper bound for a single Retry-After wait (10 min). If this exceeds the remaining budget, we throw immediately without sleeping.

type AutotaskContexts = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

/**
 * Detects Autotask thread-concurrency rejections (Itgenatr005 / "thread threshold ... exceeded").
 * These may arrive with a non-429 HTTP status, so we inspect the error body/message too.
 */
type ErrorEntry = string | { message?: string } | null | undefined;

function isThreadLimitError(error: unknown): boolean {
	const err = error as {
		message?: string;
		errors?: ErrorEntry[];
		error?: { errors?: ErrorEntry[] };
		response?: { data?: { errors?: ErrorEntry[] } };
	};
	const parts: string[] = [];
	if (typeof err.message === 'string') parts.push(err.message);

	// Autotask/n8n error bodies expose the errors array at several shapes
	// (see request.ts: response.data.errors, error.errors, top-level errors).
	// Inspect all of them so a non-429 thread-limit rejection is detected
	// regardless of which shape the error arrives in.
	const collectErrors = (errs: ErrorEntry[] | undefined): void => {
		if (!Array.isArray(errs)) return;
		for (const e of errs) {
			if (typeof e === 'string') parts.push(e);
			else if (e && typeof e.message === 'string') parts.push(e.message);
		}
	};
	collectErrors(err.response?.data?.errors);
	collectErrors(err.errors);
	collectErrors(err.error?.errors);

	const haystack = parts.join(' ').toLowerCase();
	return (
		haystack.includes('itgenatr005') ||
		/thread\s+threshold.*exceeded/.test(haystack) ||
		/thread limit/.test(haystack)
	);
}

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

	while (true) {
		try {
			return await requestFn();
		} catch (error: unknown) {
			const err = error as { response?: { status?: number; headers?: Record<string, string> } };
			const status = err.response?.status;

			// Retry 429s AND Autotask thread-limit rejections (which may use a non-429 status)
			if (status !== 429 && !isThreadLimitError(error)) {
				// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
				throw error;
			}

			attempt += 1;

			// Parse Retry-After header if present (RFC 7231: integer seconds or HTTP-date)
			const retryAfter = err.response?.headers?.['retry-after'];
			let waitMs: number;

			if (retryAfter) {
				const parsed = Number.parseInt(retryAfter, 10);
				if (!Number.isNaN(parsed)) {
					// Integer seconds: respect server value, floor at 1s, cap at 10 min
					// Floor prevents Retry-After: 0 or negative values from creating a hot retry loop
					waitMs = Math.max(1_000, Math.min(parsed * 1_000, MAX_RETRY_AFTER_MS));
				} else {
					// HTTP-date format: compute delta from now
					const httpDate = Date.parse(retryAfter);
					if (!Number.isNaN(httpDate)) {
						waitMs = Math.max(1_000, Math.min(httpDate - Date.now(), MAX_RETRY_AFTER_MS));
					} else {
						waitMs = 60_000; // unparseable — fall back to 60s
					}
				}
			} else {
				// Exponential backoff with jitter (+/-25%)
				const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
				const jitterRange = backoff * 0.25;
				const jitter = Math.random() * jitterRange * 2 - jitterRange;
				waitMs = Math.max(1_000, backoff + jitter);
			}

			console.warn(
				`[429 Retry] Attempt ${attempt}, waiting ${(waitMs / 1_000).toFixed(
					1,
				)}s (total wait so far: ${(totalWaitTime / 1_000).toFixed(0)}s / ${
					MAX_TOTAL_WAIT_MS / 1_000
				}s)`,
			);

			// Reject immediately if the single wait would overshoot the remaining budget.
			// This prevents blocking the workflow for the full capped duration (up to 600s)
			// before throwing — which would violate the 5-minute MAX_TOTAL_WAIT_MS contract.
			const remainingBudget = MAX_TOTAL_WAIT_MS - totalWaitTime;
			if (waitMs > remainingBudget) {
				const rateLimitError = {
					message:
						'Autotask API rate limit exceeded (429 Too Many Requests). ' +
						`Retry-After of ${(waitMs / 1_000).toFixed(0)}s exceeds remaining budget of ${(remainingBudget / 1_000).toFixed(0)}s. ` +
						'Suggestions: (1) Reduce workflow trigger frequency or concurrency. ' +
						'(2) Enable response caching on read operations. ' +
						'(3) Spread bulk operations over a longer time period.',
					statusCode: 429,
					description: `Retry-After exceeds budget after ${attempt} attempt(s).`,
				};
				throw new NodeApiError(context.getNode(), rateLimitError);
			}

			// Sleep is within budget — honour it.
			await new Promise((resolve) => setTimeout(resolve, waitMs));

			totalWaitTime += waitMs;
			// No post-sleep budget check here. The pre-sleep guard above
			// (`waitMs > remainingBudget`) is the sole enforcement point.
			// A post-sleep `>= MAX_TOTAL_WAIT_MS` check would incorrectly abort
			// when a Retry-After wait lands exactly on the remaining budget —
			// the server asked us to wait that long and we should retry, not throw.
		}
	}
}

