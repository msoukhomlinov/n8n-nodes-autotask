import type { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions, ISupplyDataFunctions } from 'n8n-workflow';
import { getTrackerForCredential, rateTracker } from './rateLimit';
import { fetchThresholdInformation } from './request';
import { readSharedUsageSnapshot } from './redis/usageStore';
import { autotaskCredentialStore } from '../credential-store';
import { sanitizeErrorForLogging, createOverrideScrubber } from '../security/credential-masking';

const initTimes = new Map<string, number>();
const INIT_COOLDOWN_MS = 300_000; // 5 minutes

/**
 * Initializes the rate tracker for a specific credential with the proper
 * threshold information fetcher. Uses a per-credential cooldown so concurrent
 * executions do not all trigger a threshold information request.
 *
 * @param context Execution context with access to credentials
 * @param credentialKey Unique key identifying the credential (zone|Username|APIIntegrationcode).
 *   Defaults to 'default', which shares the global singleton — always pass an explicit key for per-credential isolation.
 */
export async function initializeRateTracker(
	context: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | ISupplyDataFunctions,
	credentialKey = 'default',
): Promise<void> {
	const now = Date.now();
	const lastInit = initTimes.get(credentialKey) ?? 0;

	if (now - lastInit < INIT_COOLDOWN_MS) {
		return;
	}

	initTimes.set(credentialKey, now);

	try {
		const tracker = getTrackerForCredential(credentialKey);

		tracker.setThresholdInfoFetcher(async () => {
			try {
				// Snapshot-first: prefer the shared Redis usage snapshot a peer worker
				// already polled, avoiding a redundant ThresholdInformation request (which
				// itself consumes a thread slot). Only poll the API directly on a miss.
				const shared = await readSharedUsageSnapshot(context);
				if (shared) {
					return {
						externalRequestThreshold: shared.externalRequestThreshold,
						requestThresholdTimeframe: shared.requestThresholdTimeframe,
						currentTimeframeRequestCount: shared.currentTimeframeRequestCount,
					};
				}
				const result = await fetchThresholdInformation.call(context as IExecuteFunctions);
				return result;
			} catch (error) {
				const scrub = createOverrideScrubber(autotaskCredentialStore.getStore());
				const sanitized = sanitizeErrorForLogging(error);
				if (typeof sanitized.message === 'string') sanitized.message = scrub(sanitized.message);
				console.error('[RateTracker] Error in threshold fetcher:', sanitized);
				return null;
			}
		});

		await tracker.syncWithApi();
	} catch (error) {
		// Allow immediate retry on next invocation rather than blocking for 5 min
		initTimes.delete(credentialKey);
		const scrub = createOverrideScrubber(autotaskCredentialStore.getStore());
		const sanitized = sanitizeErrorForLogging(error);
		if (typeof sanitized.message === 'string') sanitized.message = scrub(sanitized.message);
		console.error('[RateTracker] Failed to initialize rate tracker:', sanitized);
	}
}

/**
 * Simplified early-init that doesn't require an execution context.
 * The default tracker starts with local counting only and syncs when
 * a context is available via initializeRateTracker.
 */
export function initializeRateTrackerEarly(): void {
	try {
		// Touch the default tracker to ensure the singleton is instantiated
		void rateTracker;
	} catch (error) {
		console.error('[RateTracker] Critical initialization error:', error);
	}
}
