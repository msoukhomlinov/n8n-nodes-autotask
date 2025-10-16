import type {
    IExecuteFunctions,
    IHookFunctions,
    ILoadOptionsFunctions,
} from 'n8n-workflow';
import { rateTracker } from './rateLimit';
import { fetchThresholdInformation } from './request';

/**
 * Initializes the rate tracker with the proper threshold information fetcher
 *
 * @param context Execution context with access to credentials
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeRateTracker(
    context: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
): Promise<void> {
    try {
        console.log('[RateTracker] Initialising with context...');

        // Set up the threshold info fetcher to use the context for credentials
        rateTracker.setThresholdInfoFetcher(async () => {
            try {
                console.log('[RateTracker] Fetching threshold information from Autotask API...');
                const result = await fetchThresholdInformation.call(context);

                if (result) {
                    console.log(`[RateTracker] API returned threshold data: current usage ${result.currentTimeframeRequestCount}/${result.externalRequestThreshold}`);
                } else {
                    console.warn('[RateTracker] API returned null threshold data');
                }

                return result;
            } catch (error) {
                // Import sanitization function to mask credentials in error logs
                const { sanitizeErrorForLogging } = await import('../security/credential-masking');
                console.error('[RateTracker] Error in threshold fetcher:', sanitizeErrorForLogging(error));
                return null;
            }
        });

        // Trigger an initial sync
        console.log('[RateTracker] Triggering initial API sync...');
        await rateTracker.syncWithApi();
        console.log('[RateTracker] Successfully initialized with Autotask API threshold info');
    } catch (error) {
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
