/**
 * Tracks and limits concurrent API requests per endpoint to prevent API thread limit errors
 *
 * Autotask enforces thread limits on simultaneous API execution to prevent resource exhaustion.
 * This tracker ensures we don't exceed the concurrent request limit per endpoint.
 *
 * The limit of 3 threads per endpoint is based on Autotask's post-2023.1 integration guidelines.
 * For more information, see:
 * https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm
 */
class EndpointThreadTracker {
    private static instance: EndpointThreadTracker;
    private activeThreadsPerEndpoint: Record<string, number> = {};
    private readonly threadLimit = 3; // Limit for post-2023.1 integrations per Autotask API docs
    private readonly enableDebugLogs = false; // Set to false to disable startup logs

    private constructor() {
        this.debugLog('Endpoint thread tracker initialized');
    }

    public static getInstance(): EndpointThreadTracker {
        if (!EndpointThreadTracker.instance) {
            EndpointThreadTracker.instance = new EndpointThreadTracker();
        }
        return EndpointThreadTracker.instance;
    }

    /**
     * Outputs debug log messages when debug logging is enabled
     */
    private debugLog(message: string, ...args: unknown[]): void {
        if (this.enableDebugLogs) {
            console.debug(`[ThreadTracker] ${message}`, ...args);
        }
    }

    /**
     * Extracts the endpoint name from a URL
     * This is a fallback method for when endpoint names aren't directly available
     */
    private getEndpointFromUrl(url: string): string {
        // Try different regex patterns to cover more URL formats
        const patterns = [
            /\/V\d+\/(\w+)/i,           // /V1.0/Tickets
            /\/v\d+\/(\w+)/i,           // /v1.0/Tickets
            /\/api\/v\d+\/(\w+)/i,      // /api/v1.0/Tickets
            /\/\w+\/v\d+\/(\w+)/i,      // /ATServicesRest/v1.0/Tickets
            /\/([^/]+)\/query/i,        // /Tickets/query
            /\/([^/]+)\/\d+/i,          // /Tickets/123
            /\/([^/]+)\/?$/i            // /Tickets or /Tickets/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match?.[1]) {
                return match[1].toLowerCase();
            }
        }

        this.debugLog(`Could not extract endpoint from URL: ${url}`);
        return "unknown";
    }

    /**
     * Acquires a thread for the specified endpoint or URL
     * Waits until a thread is available if all are in use
     */
    public async acquireThread(endpointOrUrl: string): Promise<void> {
        let endpoint: string;

        // Check if this is an endpoint name or a URL
        if (endpointOrUrl.includes('://') || endpointOrUrl.startsWith('/')) {
            // It's a URL, extract the endpoint
            endpoint = this.getEndpointFromUrl(endpointOrUrl);
        } else {
            // It's already an endpoint name
            endpoint = endpointOrUrl.toLowerCase();
        }

        // Initialize if needed
        if (this.activeThreadsPerEndpoint[endpoint] === undefined) {
            this.activeThreadsPerEndpoint[endpoint] = 0;
        }

        // Wait until a thread is available
        while (this.activeThreadsPerEndpoint[endpoint] >= this.threadLimit) {
            this.debugLog(`Waiting for thread availability for endpoint: ${endpoint}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Acquire thread
        this.activeThreadsPerEndpoint[endpoint]++;
        this.debugLog(`Thread acquired for ${endpoint}: ${this.activeThreadsPerEndpoint[endpoint]}/${this.threadLimit}`);
    }

    /**
     * Releases a thread for the specified endpoint or URL
     */
    public releaseThread(endpointOrUrl: string): void {
        let endpoint: string;

        // Check if this is an endpoint name or a URL
        if (endpointOrUrl.includes('://') || endpointOrUrl.startsWith('/')) {
            // It's a URL, extract the endpoint
            endpoint = this.getEndpointFromUrl(endpointOrUrl);
        } else {
            // It's already an endpoint name
            endpoint = endpointOrUrl.toLowerCase();
        }

        if (this.activeThreadsPerEndpoint[endpoint] !== undefined) {
            this.activeThreadsPerEndpoint[endpoint]--;
            this.debugLog(`Thread released for ${endpoint}: ${this.activeThreadsPerEndpoint[endpoint]}/${this.threadLimit}`);
        }
    }
}

/**
 * Initialize the endpoint thread tracker early
 */
export function initializeThreadTrackerEarly(): void {
    try {
        // Silently initialize the thread tracker without logging
        // This line ensures the singleton is instantiated
        endpointThreadTracker;

        // No console output to keep n8n startup clean
    } catch (error) {
        // Only log critical errors
        console.error('[ThreadTracker] Critical initialization error:', error);
    }
}

// Export singleton instance
export const endpointThreadTracker = EndpointThreadTracker.getInstance();
