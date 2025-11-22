/**
 * Tracks API request rates to prevent hitting rate limits
 */
class RequestRateTracker {
    private static instance: RequestRateTracker;
    private requestCount = 0;
    private counterResetTime = 0;
    private readonly hourInMs = 3600000;
    private readonly maxRequestsPerHour = 10000;
    private readonly enableDebugLogs = false; // Toggle debug logging - set to false to disable startup logs

    // Threshold sync properties
    private lastSyncTime = 0;
    private syncIntervalMs = 3600000;    // Sync every hour
    private actualUsageCount = 0;
    private thresholdLimit = 10000;
    private syncPromise: Promise<void> | null = null;

    private constructor() {
        this.counterResetTime = Date.now() + this.hourInMs;
        this.debugLog('Rate tracker initialized with counter reset at', new Date(this.counterResetTime).toISOString());
    }

    public static getInstance(): RequestRateTracker {
        if (!RequestRateTracker.instance) {
            RequestRateTracker.instance = new RequestRateTracker();
        }
        return RequestRateTracker.instance;
    }

    /**
     * Outputs debug log messages when debug logging is enabled
     */
    private debugLog(message: string, ...args: unknown[]): void {
        if (this.enableDebugLogs) {
            console.debug(`[RateTracker] ${message}`, ...args);
        }
    }

    /**
     * Records a new API request and returns current usage percentage
     */
    public trackRequest(): number {
        this.resetCounterIfNeeded();

        // Increment request counter
        this.requestCount++;

        if (this.requestCount % 100 === 0) {
            this.debugLog(`Request counter milestone: ${this.requestCount} requests tracked locally`);
        }

        // Check if we need to sync with the API
        this.maybeSyncWithApi();

        // Return the percentage based on actual API usage when available,
        // otherwise use our local tracking
        if (this.actualUsageCount > 0) {
            const usage = (this.actualUsageCount / this.thresholdLimit) * 100;
            return usage;
        }

        const usage = (this.requestCount / this.maxRequestsPerHour) * 100;
        return usage;
    }

    /**
     * Resets the counter if the hour window has passed
     * Consolidates reset logic to prevent duplication
     */
    private resetCounterIfNeeded(): void {
        const now = Date.now();
        if (now >= this.counterResetTime) {
            const oldCount = this.requestCount;
            this.requestCount = 0;
            this.counterResetTime = now + this.hourInMs;
            this.debugLog(`Counter reset: ${oldCount} → 0, next reset at ${new Date(this.counterResetTime).toISOString()}`);
        }
    }

    /**
     * Gets the current request count for the last hour
     */
    public getCurrentCount(): number {
        this.resetCounterIfNeeded();

        // Use actual API count when available
        if (this.actualUsageCount > 0) {
            return this.actualUsageCount;
        }

        return this.requestCount;
    }

    /**
     * Checks if we should pause before making another request
     */
    public shouldThrottle(): boolean {
        // Use actual API count when available
        if (this.actualUsageCount > 0) {
            const shouldThrottle = this.actualUsageCount >= this.thresholdLimit;
            if (shouldThrottle) {
                this.debugLog(`Throttling activated: actual API usage (${this.actualUsageCount}) >= threshold (${this.thresholdLimit})`);
            }
            return shouldThrottle;
        }

        const shouldThrottle = this.getCurrentCount() >= this.maxRequestsPerHour;
        if (shouldThrottle) {
            this.debugLog(`Throttling activated: local counter (${this.requestCount}) >= max (${this.maxRequestsPerHour})`);
        }
        return shouldThrottle;
    }

    /**
     * Gets the current rate limit threshold
     */
    public getThresholdLimit(): number {
        return this.actualUsageCount > 0 ? this.thresholdLimit : this.maxRequestsPerHour;
    }

    /**
     * Gets recommended pause duration based on current usage
     */
    public getThrottleDuration(): number {
        // Calculate usage percentage based on actual API count when available
        const usage = this.actualUsageCount > 0
            ? this.actualUsageCount / this.thresholdLimit
            : this.getCurrentCount() / this.maxRequestsPerHour;

        let throttleDuration = 0;
        if (usage >= 0.9) {
            throttleDuration = 5000; // 5 seconds when close to limit
            this.debugLog(`High throttle (5000ms) applied at ${(usage * 100).toFixed(1)}% usage`);
        } else if (usage >= 0.75) {
            throttleDuration = 2000; // 2 seconds at high usage
            this.debugLog(`Medium throttle (2000ms) applied at ${(usage * 100).toFixed(1)}% usage`);
        } else if (usage >= 0.5) {
            throttleDuration = 1000; // 1 second at moderate usage
            this.debugLog(`Light throttle (1000ms) applied at ${(usage * 100).toFixed(1)}% usage`);
        }

        return throttleDuration;
    }

    /**
     * Schedule a sync with the Autotask API's ThresholdInformation endpoint
     * if it's been long enough since the last sync
     */
    private maybeSyncWithApi(): void {
        const now = Date.now();
        if (now - this.lastSyncTime >= this.syncIntervalMs && !this.syncPromise) {
            this.debugLog('Scheduling threshold sync');
            this.syncPromise = this.syncWithApi().finally(() => {
                this.syncPromise = null;
            });
        }
    }

    /**
     * Sync with the Autotask API to get actual usage statistics
     *
     * Note: The ThresholdInformation API call itself IS counted by Autotask in their total.
     * We sync the actual count from the API response to keep our local tracking accurate.
     */
    public async syncWithApi(): Promise<void> {
        this.debugLog('Starting API threshold sync');
        try {
            // Fetch threshold information from Autotask
            // Note: This call bypasses our rate limiter to avoid circular dependency,
            // but Autotask still counts it in their total
            const result = await this.fetchThresholdInfo();

            if (result) {
                // Log values before update
                const oldCount = this.requestCount;
                const oldActualCount = this.actualUsageCount;
                const oldThreshold = this.thresholdLimit;

                // Sync our local counter with the actual API count
                // This includes the ThresholdInformation call we just made
                this.actualUsageCount = result.currentTimeframeRequestCount;
                this.thresholdLimit = result.externalRequestThreshold;
                this.requestCount = result.currentTimeframeRequestCount;
                this.lastSyncTime = Date.now();

                // Reset the counter reset time based on the current time
                this.counterResetTime = Date.now() + this.hourInMs;

                this.debugLog(
                    `Threshold sync complete:
                    - API count: ${oldActualCount} → ${this.actualUsageCount}
                    - Local count: ${oldCount} → ${this.requestCount}
                    - Limit: ${oldThreshold} → ${this.thresholdLimit}
                    - Next reset: ${new Date(this.counterResetTime).toISOString()}
                    - Next sync: ${new Date(this.lastSyncTime + this.syncIntervalMs).toISOString()}`
                );
            } else {
                this.debugLog('Threshold sync failed: No result from fetchThresholdInfo');
            }
        } catch (error) {
            this.debugLog('Threshold sync error:', error);
            // Import sanitization function to mask credentials in error logs
            const { sanitizeErrorForLogging } = await import('../security/credential-masking');
            console.error('Failed to sync with Autotask API threshold information:', sanitizeErrorForLogging(error));
            // Fall back to local tracking on error
        }
    }

    /**
     * Fetch threshold information from the Autotask API
     * This will be overridden by the main code to avoid circular dependencies
     */
    public fetchThresholdInfo: () => Promise<{
        externalRequestThreshold: number;
        requestThresholdTimeframe: number;
        currentTimeframeRequestCount: number;
    } | null> = async () => {
        this.debugLog('Default ThresholdInfo fetcher called (not implemented)');
        return null;
    };

    /**
     * Set the function to fetch threshold information
     */
    public setThresholdInfoFetcher(
        fetcher: () => Promise<{
            externalRequestThreshold: number;
            requestThresholdTimeframe: number;
            currentTimeframeRequestCount: number;
        } | null>
    ): void {
        this.debugLog('Threshold info fetcher set');
        this.fetchThresholdInfo = fetcher;
    }
}

/**
 * Calculates base throttle duration based on usage
 */
export function calculateThrottleDuration(usagePercent: number): number {
    if (usagePercent >= 90) {
        return 5000; // 5 seconds when close to limit (90%+)
    } else if (usagePercent >= 75) {
        return 2000; // 2 seconds at high usage (75-90%)
    } else if (usagePercent >= 50) {
        return 1000; // 1 second at moderate usage (50-75%)
    }
    return 0; // No throttling at low usage
}

/**
 * Handles rate limiting for API requests
 *
 * Implements progressive throttling based on usage:
 * - 50-75%: 1 second delay
 * - 75-90%: 2 second delay
 * - 90%+: 5 second delay
 * - At/over limit: Wait until rolling 60-minute window allows new requests
 *
 * Note: Autotask also adds server-side latency:
 * - 50-75% usage: +0.5s per request
 * - 75%+ usage: +1s per request
 * See: https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm
 *
 * @param maxWaitMs Maximum time to wait before giving up (default: 10 minutes)
 * @throws Error if rate limit cannot be satisfied within maxWaitMs
 */
export async function handleRateLimit(maxWaitMs = 600000): Promise<void> {
    const rateTracker = RequestRateTracker.getInstance();
    const usagePercent = rateTracker.trackRequest();

    // If we're at or over the rate limit, wait until the rolling window allows new requests
    if (rateTracker.shouldThrottle()) {
        const currentCount = rateTracker.getCurrentCount();
        const limit = rateTracker.getThresholdLimit();

        console.warn(`[RateLimit] Rate limit reached: ${currentCount}/${limit} requests. Waiting for rolling window to reset...`);

        // Calculate how long to wait based on the rolling 60-minute window
        // We need to wait until enough time has passed for the oldest requests to fall out of the window
        const waitInterval = 5000; // Check every 5 seconds
        let totalWaitTime = 0;

        while (rateTracker.shouldThrottle() && totalWaitTime < maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, waitInterval));
            totalWaitTime += waitInterval;

            // Try to sync with API to get updated count every 30 seconds
            if (totalWaitTime >= 30000 && totalWaitTime % 30000 < waitInterval) {
                console.debug(`[RateLimit] Still waiting... (${(totalWaitTime / 1000).toFixed(0)}s elapsed)`);
                await rateTracker.syncWithApi();
            }
        }

        if (rateTracker.shouldThrottle()) {
            throw new Error(
                `Rate limit exceeded: Unable to proceed after waiting ${(maxWaitMs / 1000).toFixed(0)} seconds. ` +
                `Current usage: ${currentCount}/${limit} requests in the last 60 minutes. ` +
                `Please reduce API call frequency or wait for the rolling window to reset.`
            );
        }

        console.log(`[RateLimit] Rate limit cleared after ${(totalWaitTime / 1000).toFixed(0)}s wait`);
        return;
    }

    // Apply progressive throttling based on current usage
    const throttleDelay = rateTracker.getThrottleDuration();
    if (throttleDelay > 0) {
        console.debug(`[RateLimit] Applying throttle delay of ${throttleDelay}ms (usage: ${usagePercent.toFixed(1)}%)`);
        await new Promise(resolve => setTimeout(resolve, throttleDelay));
    }
}

export const rateTracker = RequestRateTracker.getInstance();
