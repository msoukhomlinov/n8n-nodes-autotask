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
                console.error('[RateTracker] Error in threshold fetcher:', error);
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
        console.log('[RateTracker] Early initialization (without API sync)');

        // Just ensure the rate tracker is instantiated
        // It will use local counting until a proper fetcher is set
        const instance = rateTracker;

        if (instance) {
            console.log('[RateTracker] Early initialization successful, using local counting until API sync is available');
        }
    } catch (error) {
        console.error('[RateTracker] Failed early initialization:', error);
    }
}
