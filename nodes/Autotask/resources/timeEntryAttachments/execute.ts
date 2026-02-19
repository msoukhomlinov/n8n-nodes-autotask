import type { IExecuteFunctions, INodeExecutionData, IBinaryData, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { autotaskApiRequest } from '../../helpers/http';
import { ATTACHMENT_TYPE, validateAttachmentSize, type IAttachmentPayload } from '../../helpers/attachment';

const ENTITY_TYPE = 'timeEntryAttachment';

export async function executeTimeEntryAttachmentOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					const timeEntryId = this.getNodeParameter('timeEntryId', i) as string;
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const title = this.getNodeParameter('title', i) as string;
					const publish = this.getNodeParameter('publish', i, 1) as number;

					// Get binary data from input
					const binaryData = items[i].binary;
					if (!binaryData || !binaryData[binaryPropertyName]) {
						throw new Error(`Binary property "${binaryPropertyName}" not found in input`);
					}

					const binaryItem = binaryData[binaryPropertyName];
					// Use getBinaryDataBuffer to correctly retrieve binary data in all n8n storage modes
					const dataBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

					// Validate file size
					validateAttachmentSize(dataBuffer.length);

					// Get file name from binary data or use a default
					const fileName = binaryItem.fileName || `attachment-${Date.now()}`;

					// Build endpoint and payload
					const endpoint = `TimeEntries/${timeEntryId}/Attachments/`;
					const payload: IAttachmentPayload = {
						id: 0,
						attachmentType: ATTACHMENT_TYPE,
						data: dataBuffer.toString('base64'),
						fullPath: fileName,
						title: title,
						publish: publish,
						timeEntryID: Number(timeEntryId),
					};

					const response = await autotaskApiRequest.call(this, 'POST', endpoint, payload as IDataObject) as { item: { itemId: number } };
					returnData.push({
						json: {
							id: response.item?.itemId,
							timeEntryId: Number(timeEntryId),
							title: title,
							fileName: fileName,
						},
					});
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this, { parentType: 'timeEntry' });
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}
				case 'count': {
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const count = await countOp.execute(i);
					returnData.push({
						json: {
							count,
						},
					});
					break;
				}

				case 'download': {
					const timeEntryId = this.getNodeParameter('timeEntryId', i) as string;
					const attachmentId = this.getNodeParameter('id', i) as string;
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;

					// Build endpoint: /TimeEntries/{timeEntryId}/Attachments/{attachmentId}
					const endpoint = `TimeEntries/${timeEntryId}/Attachments/${attachmentId}/`;

					const response = await autotaskApiRequest.call(this, 'GET', endpoint) as {
						items: Array<{
							id: number;
							data: string;
							contentType?: string;
							fullPath: string;
							title?: string;
							attachDate?: string;
						}>;
					};

					const attachment = response.items?.[0];
					if (!attachment?.data) {
						throw new Error('Failed to retrieve attachment data');
					}

					const binaryData: IBinaryData = {
						data: attachment.data,
						mimeType: attachment.contentType || 'application/octet-stream',
						fileName: attachment.fullPath,
					};

					returnData.push({
						json: {
							id: attachment.id,
							title: attachment.title,
							fileName: attachment.fullPath,
							contentType: attachment.contentType,
							attachDate: attachment.attachDate,
						},
						binary: { [binaryPropertyName]: binaryData },
					});
					break;
				}

				case 'delete': {
					const timeEntryId = this.getNodeParameter('timeEntryId', i) as string;
					const attachmentId = this.getNodeParameter('id', i) as string;

					// Build endpoint: /TimeEntries/{timeEntryId}/Attachments/{attachmentId}
					const endpoint = `TimeEntries/${timeEntryId}/Attachments/${attachmentId}/`;

					await autotaskApiRequest.call(this, 'DELETE', endpoint);
					returnData.push({
						json: {
							success: true,
							id: Number(attachmentId),
							timeEntryId: Number(timeEntryId),
						},
					});
					break;
				}
				default:
					throw new Error(`Operation ${operation} is not supported`);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: error.message } });
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
