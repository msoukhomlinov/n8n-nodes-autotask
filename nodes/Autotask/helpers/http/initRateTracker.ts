import type { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { rateTracker } from './rateLimit';
import { fetchThresholdInformation } from './request';
import { autotaskCredentialStore } from '../credential-store';
import { sanitizeErrorForLogging, createOverrideScrubber } from '../security/credential-masking';

let lastInitTime = 0;
const INIT_COOLDOWN_MS = 300_000; // 5 minutes

/**
 * Initializes the rate tracker with the proper threshold information fetcher
 *
 * @param context Execution context with access to credentials
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeRateTracker(
	context: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
): Promise<void> {
	const now = Date.now();

	// Simple cooldown so multiple concurrent executions do not all trigger a sync
	if (now - lastInitTime < INIT_COOLDOWN_MS) {
		return;
	}

	lastInitTime = now;

	try {
		// Set up the threshold info fetcher to use the context for credentials
		rateTracker.setThresholdInfoFetcher(async () => {
			try {
				const result = await fetchThresholdInformation.call(context);

				return result;
			} catch (error) {
				const scrub = createOverrideScrubber(autotaskCredentialStore.getStore());
				const sanitized = sanitizeErrorForLogging(error);
				if (typeof sanitized.message === 'string') sanitized.message = scrub(sanitized.message);
				console.error('[RateTracker] Error in threshold fetcher:', sanitized);
				return null;
			}
		});

		// Trigger an initial sync
		await rateTracker.syncWithApi();
	} catch (error) {
		const scrub = createOverrideScrubber(autotaskCredentialStore.getStore());
		const sanitized = sanitizeErrorForLogging(error);
		if (typeof sanitized.message === 'string') sanitized.message = scrub(sanitized.message);
		console.error('[RateTracker] Failed to initialize rate tracker:', sanitized);
	}
}

/**
 * Simplified version that doesn't require an execution context.
 * This can be used during module initialization if context isn't available yet.
 * The rate tracker will start with local counting only, and sync when it gets a context later.
 */
export function initializeRateTrackerEarly(): void {
    try {
        // Silently initialize the rate tracker without logging
        // This line ensures the singleton is instantiated
        rateTracker;

        // No console output to keep n8n startup clean
    } catch (error) {
        // Only log critical errors
        console.error('[RateTracker] Critical initialization error:', error);
    }
}
