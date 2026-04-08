import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from '../../helpers/http';
import { resolveLabelsToIds } from '../../helpers/label-resolution';

const ENTITY_TYPE = 'resourceTimeOffAdditional';

export async function executeResourceTimeOffAdditionalOperation(
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
					let resourceId = this.getNodeParameter('resourceID', i) as string | number;
					// Resolve name → numeric ID when a non-numeric string is passed (AI tools path)
					if (typeof resourceId === 'string' && !/^\d+$/.test(resourceId.trim())) {
						try {
							const resolution = await resolveLabelsToIds(this, ENTITY_TYPE, { resourceID: resourceId });
							const resolved = resolution.values.resourceID;
							if (resolved !== undefined) resourceId = resolved as number;
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							if (typeof resourceId === 'string' && !/^\d+$/.test(resourceId)) {
								throw new Error(
									`Could not resolve resource name '${resourceId}' to a numeric ID: ${msg}. Use a numeric resourceID instead.`,
								);
							}
							console.warn(`[resourceTimeOffAdditional] Label resolution failed for resourceID '${resourceId}': ${msg}`);
						}
					}
					const response = await autotaskApiRequest.call(
						this,
						'GET',
						`Resources/${resourceId}/TimeOffAdditional`,
					);
					// API returns QueryActionResult with .items array; fall back to .item or raw response
					const items_result = (response as IDataObject)?.items;
					const item_result = (response as IDataObject)?.item;
					if (Array.isArray(items_result)) {
						returnData.push({ json: { items: items_result, resourceID: resourceId } as IDataObject });
					} else {
						returnData.push({ json: (item_result ?? response) as IDataObject });
					}
					break;
				}

				case 'update': {
					// AI tools path: resourceID is resolved in fieldValues (from fieldsToMap.value)
					// Standard node path: resourceID is the dedicated text parameter
					const fieldsToMap = this.getNodeParameter('fieldsToMap', i, { value: {} }) as {
						value: Record<string, unknown>;
					};
					const fields = fieldsToMap?.value ?? {};
					// Prefer fieldsToMap value (label-resolved in AI tools path), fall back to dedicated param
					const resourceId = (fields.resourceID as string | number | undefined)
						?? (this.getNodeParameter('resourceID', i, '') as string | number);
					if (!resourceId) throw new Error('resourceID is required for update');
					const response = await autotaskApiRequest.call(
						this,
						'PATCH',
						`Resources/${resourceId}/TimeOffAdditional`,
						fields as IDataObject,
					);
					returnData.push({ json: ((response as IDataObject)?.item ?? response) as IDataObject });
					break;
				}

				default:
					throw new Error(`Operation ${operation} is not supported for Resource Time Off Additional`);
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
