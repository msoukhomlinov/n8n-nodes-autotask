import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from '../../helpers/http';
import { resolveLabelsToIds } from '../../helpers/label-resolution';

const ENTITY_TYPE = 'resourceTimeOffBalance';

async function resolveResourceId(
	context: IExecuteFunctions,
	rawId: string | number,
): Promise<string | number> {
	if (typeof rawId !== 'string' || /^\d+$/.test(rawId.trim())) {
		return rawId;
	}
	try {
		const resolution = await resolveLabelsToIds(context, ENTITY_TYPE, { resourceID: rawId });
		const resolved = resolution.values.resourceID;
		if (resolved !== undefined) return resolved as number;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// If the value is non-numeric (a name/label), resolution failure means we can't proceed
		if (typeof rawId === 'string' && !/^\d+$/.test(rawId)) {
			throw new Error(
				`Could not resolve resource name '${rawId}' to a numeric ID: ${msg}. Use a numeric resourceID instead.`,
			);
		}
		console.warn(`[resourceTimeOffBalance] Label resolution failed for resourceID '${rawId}': ${msg}`);
	}
	return rawId;
}

export async function executeResourceTimeOffBalanceOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'get':
				case 'getByResource': {
					const rawId = this.getNodeParameter('resourceID', i) as string | number;
					const resourceId = await resolveResourceId(this, rawId);
					const response = await autotaskApiRequest.call(
						this,
						'GET',
						`Resources/${resourceId}/TimeOffBalances`,
					);
					const itemsResult = (response as IDataObject)?.items ?? [(response as IDataObject)?.item ?? response];
					returnData.push({ json: { items: itemsResult, resourceID: resourceId } as IDataObject });
					break;
				}

				case 'getByYear': {
					const rawId = this.getNodeParameter('resourceID', i) as string | number;
					const resourceId = await resolveResourceId(this, rawId);
					const year = this.getNodeParameter('year', i) as number;
					const response = await autotaskApiRequest.call(
						this,
						'GET',
						`Resources/${resourceId}/TimeOffBalances/${year}`,
					);
					returnData.push({ json: ((response as IDataObject)?.item ?? response) as IDataObject });
					break;
				}

				default:
					throw new Error(`Operation ${operation} is not supported for Resource Time Off Balances`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
