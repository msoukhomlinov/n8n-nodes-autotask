import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';
import { autotaskApiRequest } from '../../helpers/http';
import type { IBinaryData, IDataObject } from 'n8n-workflow';

const ENTITY_TYPE = 'invoice';

export async function executeInvoiceOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'update': {
					const invoiceId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, invoiceId);
					returnData.push({ json: response });
					break;
				}

				case 'get': {
					const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await getOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'getMany': {
					const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const filters = await getManyOp.buildFiltersFromResourceMapper(i);
					const response = await getManyOp.execute({ filter: filters }, i);
					returnData.push(...getManyOp.processReturnData(response));
					break;
				}

				case 'getManyAdvanced': {
					const response = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
					returnData.push(...response);
					break;
				}

				case 'count': {
					const countOp = new CountOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const count = await countOp.execute(i);
					returnData.push({
						json: {
							count,
							entityType: ENTITY_TYPE,
						},
					});
					break;
				}

				case 'pdf':
				case 'markupHtml':
				case 'markupXml': {
					const invoiceId = this.getNodeParameter('id', i) as string;
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;

					// Map operation to special endpoint suffix
					const suffix = operation === 'pdf'
						? 'InvoicePDF'
						: operation === 'markupHtml'
							? 'InvoiceMarkupHtml'
							: 'InvoiceMarkupXML';

					const endpoint = `Invoices/${invoiceId}/${suffix}`;
					const fileResponse = await autotaskApiRequest.call(this, 'GET', endpoint) as unknown;

					// Flexible extraction to support both FileQueryResultModel and direct markup payloads
					const fr = fileResponse as {
						item?: { id: number; contentType?: string; fileName?: string; fileSize?: number; data?: string };
						data?: string;
						contentType?: string;
						fileName?: string;
						fileSize?: number;
						invoiceMarkup?: string;
					};

					let dataBase64: string | undefined;
					let contentType: string | undefined;
					let fileName: string | undefined;
					let fileSize: number | undefined;
					let idOut: number | undefined;

					if (typeof fr?.invoiceMarkup === 'string') {
						// Markup endpoints sometimes return a top-level HTML-encoded string
						dataBase64 = Buffer.from(fr.invoiceMarkup, 'utf8').toString('base64');
						contentType = operation === 'markupHtml' ? 'text/html' : 'application/xml';
						fileName = `invoice-${invoiceId}.${operation === 'markupHtml' ? 'html' : 'xml'}`;
					} else if (fr?.item?.data) {
						dataBase64 = fr.item.data;
						contentType = fr.item.contentType || (operation === 'pdf' ? 'application/pdf' : operation === 'markupHtml' ? 'text/html' : 'application/xml');
						fileName = fr.item.fileName || `invoice-${invoiceId}`;
						fileSize = fr.item.fileSize;
						idOut = fr.item.id;
					} else if (fr?.data) {
						dataBase64 = fr.data;
						contentType = fr.contentType || (operation === 'pdf' ? 'application/pdf' : operation === 'markupHtml' ? 'text/html' : 'application/xml');
						fileName = fr.fileName || `invoice-${invoiceId}`;
						fileSize = fr.fileSize;
					}

					if (!dataBase64) {
						throw new Error('Failed to retrieve invoice file data');
					}

					const binaryData: IBinaryData = {
						data: dataBase64,
						mimeType: contentType || (operation === 'pdf' ? 'application/pdf' : operation === 'markupHtml' ? 'text/html' : 'application/xml'),
						fileName: fileName || `invoice-${invoiceId}`,
					};

					const json: IDataObject = {
						id: idOut ?? (Number(invoiceId) || invoiceId),
						fileName,
						contentType,
						fileSize,
						endpoint: suffix,
					};

					returnData.push({ json, binary: { [binaryPropertyName]: binaryData } });
					break;
				}

				case 'getEntityInfo':
				case 'getFieldInfo': {
					const response = await executeEntityInfoOperations(operation, ENTITY_TYPE, this, i);
					returnData.push(response);
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
