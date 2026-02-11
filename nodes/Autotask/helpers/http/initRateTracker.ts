import type { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { rateTracker } from './rateLimit';
import { fetchThresholdInformation } from './request';

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
				// Import sanitization function to mask credentials in error logs
				const { sanitizeErrorForLogging } = await import('../security/credential-masking');
				// eslint-disable-next-line no-console
				console.error('[RateTracker] Error in threshold fetcher:', sanitizeErrorForLogging(error));
				return null;
			}
		});

		// Trigger an initial sync
		await rateTracker.syncWithApi();
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('[RateTracker] Failed to initialize rate tracker:', error);
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
