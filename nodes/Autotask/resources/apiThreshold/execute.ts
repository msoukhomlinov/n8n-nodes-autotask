import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { fetchThresholdInformation } from '../../helpers/http/request';
import { readSharedUsageSnapshot } from '../../helpers/http/redis/usageStore';

/**
 * Executes the API threshold information operation
 */
export async function executeApiThresholdOperation(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	// Get the operation
	const operation = this.getNodeParameter('operation', 0) as string;

	// For now we only have one operation: get
	if (operation === 'get') {
		let source: 'redis' | 'api' = 'api';
		let thresholdInfo: Awaited<ReturnType<typeof fetchThresholdInformation>> | null = null;

		// Prefer the cluster-wide shared snapshot when Redis coordination is on and healthy.
		// readSharedUsageSnapshot resolves the same poll/usage identity the poller writes
		// under (normalised baseUrl + integration code + Username) and is best-effort (null
		// on any miss/error), so a miss falls through to the direct API fetch below.
		const shared = await readSharedUsageSnapshot(this);
		if (shared) {
			thresholdInfo = shared;
			source = 'redis';
		}

		if (!thresholdInfo) {
			// Fetch the threshold information directly from the API
			thresholdInfo = await fetchThresholdInformation.call(this);
		}

		if (!thresholdInfo) {
			// If we couldn't get the information, return empty array
			return [this.helpers.returnJsonArray([{ error: 'Could not retrieve API threshold information' }])];
		}

		// Calculate the usage percentage
		const usagePercent = (thresholdInfo.currentTimeframeRequestCount / thresholdInfo.externalRequestThreshold) * 100;

		// Determine usage level
		let usageLevel = 'Normal';
		if (usagePercent >= 90) {
			usageLevel = 'Critical';
		} else if (usagePercent >= 75) {
			usageLevel = 'High';
		} else if (usagePercent >= 50) {
			usageLevel = 'Moderate';
		}

		// Return the formatted data
		return [
			this.helpers.returnJsonArray([
				{
					...thresholdInfo,
					usagePercent: Number.parseFloat(usagePercent.toFixed(2)),
					usageLevel,
					remainingRequests: thresholdInfo.externalRequestThreshold - thresholdInfo.currentTimeframeRequestCount,
					timeframeDuration: `${thresholdInfo.requestThresholdTimeframe} minutes`,
					source,
					...('syncedAt' in thresholdInfo && thresholdInfo.syncedAt
						? { syncedAt: new Date(thresholdInfo.syncedAt as number).toISOString() }
						: {}),
				},
			]),
		];
	}

	// Fallback for unsupported operations
	return [this.helpers.returnJsonArray([])];
}
