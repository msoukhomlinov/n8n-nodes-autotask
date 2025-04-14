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
        const now = Date.now();

        // Reset counter if hour has passed
        if (now >= this.counterResetTime) {
            const oldCount = this.requestCount;
            this.requestCount = 0;
            this.counterResetTime = now + this.hourInMs;
            this.debugLog(`Counter reset: ${oldCount} → 0, next reset at ${new Date(this.counterResetTime).toISOString()}`);
        }

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
     * Gets the current request count for the last hour
     */
    public getCurrentCount(): number {
        const now = Date.now();

        // Reset counter if hour has passed
        if (now >= this.counterResetTime) {
            const oldCount = this.requestCount;
            this.requestCount = 0;
            this.counterResetTime = now + this.hourInMs;
            this.debugLog(`Counter reset during getCurrentCount: ${oldCount} → 0`);
        }

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
     */
    public async syncWithApi(): Promise<void> {
        this.debugLog('Starting API threshold sync');
        try {
            // Don't count this API call in our tracking
            this.requestCount--;
            if (this.requestCount < 0) this.requestCount = 0;
            this.debugLog(`Adjusted counter to ${this.requestCount} before API call`);

            // This will be implemented by the API caller
            const result = await this.fetchThresholdInfo();

            if (result) {
                // Log values before update
                const oldCount = this.requestCount;
                const oldActualCount = this.actualUsageCount;
                const oldThreshold = this.thresholdLimit;

                // When we get the actual count, adjust our local counter to match it
                // This helps keep the counter more accurate between syncs
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
            console.error('Failed to sync with Autotask API threshold information:', error);
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
 */
export async function handleRateLimit(): Promise<void> {
    const rateTracker = RequestRateTracker.getInstance();
    const usagePercent = rateTracker.trackRequest();

    // If we're over the rate limit, wait before proceeding
    if (rateTracker.shouldThrottle()) {
        const baseDelay = rateTracker.getThrottleDuration();
        console.debug(`[RateLimit] Adding throttle delay of ${baseDelay}ms (at limit)`);
        await new Promise(resolve => setTimeout(resolve, baseDelay));
    }

    // Add small delay based on current usage
    const throttleDelay = rateTracker.getThrottleDuration();
    if (throttleDelay > 0) {
        console.debug(`[RateLimit] Adding throttle delay of ${throttleDelay}ms (usage: ${usagePercent.toFixed(1)}%)`);
        await new Promise(resolve => setTimeout(resolve, throttleDelay));
    }
}

export const rateTracker = RequestRateTracker.getInstance();
