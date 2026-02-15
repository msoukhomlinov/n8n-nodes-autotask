import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import {
	CreateOperation,
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { executeEntityInfoOperations } from '../../operations/common/entityInfo.execute';
import { handleGetManyAdvancedOperation } from '../../operations/common/get-many-advanced';

const ENTITY_TYPE = 'contact';

function parseRequiredPositiveInt(value: string, fieldLabel: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${fieldLabel} must be a positive integer`);
	}
	return parsed;
}

export async function executeContactOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'create': {
					const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await createOp.execute(i);
					returnData.push({ json: response });
					break;
				}

				case 'update': {
					const entityId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, entityId);
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
					const results = await handleGetManyAdvancedOperation.call(this, ENTITY_TYPE, i);
					returnData.push(...results);
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

				case 'moveToCompany': {
					const { moveContactToCompany } = await import('../../helpers/contact-mover');
					const { getOptionalImpersonationResourceId } = await import('../../helpers/impersonation');
					const sourceContactId = parseRequiredPositiveInt(
						this.getNodeParameter('sourceContactId', i) as string,
						'Source Contact ID',
					);
					const destinationCompanyId = parseRequiredPositiveInt(
						this.getNodeParameter('destinationCompanyId', i) as string,
						'Destination Company ID',
					);
					const locationRaw = this.getNodeParameter('destinationCompanyLocationId', i, '') as string;
					const skipIfDuplicateEmailFound = this.getNodeParameter('skipIfDuplicateEmailFound', i, true) as boolean;
					const copyContactGroups = this.getNodeParameter('copyContactGroups', i, true) as boolean;
					const copyCompanyNotes = this.getNodeParameter('copyCompanyNotes', i, true) as boolean;
					const copyNoteAttachments = this.getNodeParameter('copyNoteAttachments', i, true) as boolean;
					const sourceAuditNote = this.getNodeParameter('sourceAuditNote', i, '') as string;
					const destinationAuditNote = this.getNodeParameter('destinationAuditNote', i, '') as string;
					const dryRun = this.getNodeParameter('dryRun', i, false) as boolean;
					const impersonationResourceId = getOptionalImpersonationResourceId(this, i);
					const proceedWithoutImpersonationIfDenied = this.getNodeParameter(
						'proceedWithoutImpersonationIfDenied',
						i,
						true,
					) as boolean;

					let destinationCompanyLocationId: number | null | undefined;
					if (locationRaw === '') {
						destinationCompanyLocationId = null;
					} else {
						destinationCompanyLocationId = Number.parseInt(locationRaw, 10);
						if (!Number.isInteger(destinationCompanyLocationId) || destinationCompanyLocationId <= 0) {
							throw new Error('Destination Location ID must be a positive integer or left blank for auto-mapping');
						}
					}

					const result = await moveContactToCompany(this, i, {
						sourceContactId, destinationCompanyId, destinationCompanyLocationId,
						skipIfDuplicateEmailFound,
						copyContactGroups, copyCompanyNotes, copyNoteAttachments,
						sourceAuditNote, destinationAuditNote,
						dryRun,
						impersonationResourceId,
						proceedWithoutImpersonationIfDenied,
					});
					returnData.push({ json: result as unknown as IDataObject });
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
			const err = error as Error;
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: err.message },
					pairedItem: { item: i },
				});
				continue;
			}
			throw new NodeOperationError(this.getNode(), err, { itemIndex: i });
		}
	}

	return [returnData];
}
