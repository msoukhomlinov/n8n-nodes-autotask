import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { fetchThresholdInformation } from '../../helpers/http/request';

/**
 * Executes the API threshold information operation
 */
export async function executeApiThresholdOperation(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	// Get the operation
	const operation = this.getNodeParameter('operation', 0) as string;

	// For now we only have one operation: get
	if (operation === 'get') {
		// Fetch the threshold information
		const thresholdInfo = await fetchThresholdInformation.call(this);

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
				},
			]),
		];
	}

	// Fallback for unsupported operations
	return [this.helpers.returnJsonArray([])];
}
