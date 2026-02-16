import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type {
	IAutotaskEntity,
	IAutotaskCredentials,
	IAutotaskQueryInput,
} from '../../types';
import {
	UpdateOperation,
	GetOperation,
	GetManyOperation,
	CountOperation,
} from '../../operations/base';
import { getSelectedColumns, prepareIncludeFields } from '../../operations/common/select-columns';
import { getCachedOrFetch, createFilterCacheKeySuffix } from '../../helpers/cache/response-cache';

const ENTITY_TYPE = 'resource';

function parseRequiredPositiveInt(value: string, fieldLabel: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldLabel} must be a positive integer`);
  }
  return parsed;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStatusValueCsv(value: string): string[] {
  const parts = parseCsv(value);
  for (const part of parts) {
    const parsed = Number.parseInt(part, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Status allowlist values must be comma-separated positive integers. Invalid value: "${part}"`);
    }
  }
  return parts;
}

function parsePositiveIntCsv(value: string, fieldLabel: string): number[] {
  const parts = parseCsv(value);
  for (const part of parts) {
    const parsed = Number.parseInt(part, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${fieldLabel} must be comma-separated non-negative integers. Invalid value: "${part}"`);
    }
  }
  return parts.map((part) => Number.parseInt(part, 10));
}

function resolveDueBeforeFromPreset(dueWindowPreset: string, dueBeforeCustom: string): string | null {
  if (!dueWindowPreset) return null;
  if (dueWindowPreset === 'custom') {
    const trimmed = dueBeforeCustom.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const offsetByPreset: Record<string, number> = {
    today: 0,
    tomorrow: 1,
    plus2Days: 2,
    plus3Days: 3,
    plus4Days: 4,
    plus5Days: 5,
    plus7Days: 7,
    plus14Days: 14,
    plus30Days: 30,
  };
  const offset = offsetByPreset[dueWindowPreset];
  if (offset === undefined) {
    throw new Error(`Unsupported due window preset: ${dueWindowPreset}`);
  }

  const now = new Date();
  const baseUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset);
  const date = new Date(baseUtc).toISOString().slice(0, 10);
  return date;
}

function isParameterExplicitlySet(context: IExecuteFunctions, parameterName: string): boolean {
  const nodeParams = context.getNode().parameters as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(nodeParams, parameterName);
}

export async function executeResourceOperation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (operation) {
				case 'update': {
					const resourceId = this.getNodeParameter('id', i) as string;
					const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, this);
					const response = await updateOp.execute(i, resourceId);
					returnData.push({ json: response });
					break;
				}

			case 'get': {
				const resourceId = this.getNodeParameter('id', i) as string;
				const result = await getCachedOrFetch<IAutotaskEntity>(
					this,
					ENTITY_TYPE,
					'get',
					i,
					resourceId, // Use entity ID as cache key suffix
					async () => {
						const getOp = new GetOperation<IAutotaskEntity>(ENTITY_TYPE, this);
						return await getOp.execute(i);
					},
				);
				returnData.push({ json: result });
				break;
			}

			case 'getMany': {
				const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);
				const filters = await getManyOp.buildFiltersFromResourceMapper(i);

				// Create cache key suffix from filter hash
				const cacheKeySuffix = createFilterCacheKeySuffix({ filter: filters });

				const results = await getCachedOrFetch<INodeExecutionData[]>(
					this,
					ENTITY_TYPE,
					'getMany',
					i,
					cacheKeySuffix, // Use hashed filters as cache key suffix
					async () => {
						const response = await getManyOp.execute({ filter: filters }, i);
						return getManyOp.processReturnData(response);
					},
				);

				returnData.push(...results);
				break;
			}

				case 'whoAmI': {
					try {
						const results = await getCachedOrFetch<INodeExecutionData[]>(
							this,
							ENTITY_TYPE,
							'whoAmI',
							i,
							undefined,
							async () => {
								// Get credentials
								const credentials = await this.getCredentials('autotaskApi') as IAutotaskCredentials;
								const email = credentials.Username as string;

								if (!email) {
									throw new Error('Username not found in credentials');
								}

								// Extract username (part before @)
								const username = email.includes('@') ? email.split('@')[0] : email;

								// Create filter for username
								const filter = [
									{
										op: 'eq',
										field: 'userName',
										value: username,
									},
								];

								// Execute query
								const getManyOp = new GetManyOperation<IAutotaskEntity>(ENTITY_TYPE, this);

								// Handle include fields for server-side filtering if needed
								const selectedColumns = getSelectedColumns(this, i);
								const includeFields = prepareIncludeFields(selectedColumns);

								// Add includeFields to the query if columns are selected
								const queryParams: IAutotaskQueryInput<IAutotaskEntity> = {
									filter,
									...(includeFields ? { includeFields } : {}),
								};

								const response = await getManyOp.execute(queryParams, i);

								// Process and return results
								return getManyOp.processReturnData(response);
							},
						);

						returnData.push(...results);
					} catch (error) {
						if (this.continueOnFail()) {
							returnData.push({ json: { error: (error as Error).message } });
						} else {
							throw error;
						}
					}
					break;
				}

				case 'transferOwnership': {
					const { transferOwnership } = await import('../../helpers/workReassigner');
					const { getOptionalImpersonationResourceId } = await import('../../helpers/impersonation');

					const sourceResourceId = parseRequiredPositiveInt(
						this.getNodeParameter('sourceResourceId', i) as string,
						'Source Resource ID',
					);
					const destinationResourceId = parseRequiredPositiveInt(
						this.getNodeParameter('destinationResourceId', i) as string,
						'Receiving Resource ID',
					);
					const dryRun = this.getNodeParameter('dryRun', i, false) as boolean;
					const includeTickets = this.getNodeParameter('includeTickets', i, false) as boolean;
					const includeProjects = this.getNodeParameter('includeProjects', i, false) as boolean;
					const includeServiceCallAssignments = this.getNodeParameter('includeServiceCallAssignments', i, false) as boolean;
					const includeAppointments = this.getNodeParameter('includeAppointments', i, false) as boolean;
					const includeCompanies = this.getNodeParameter('includeCompanies', i, false) as boolean;
					const includeOpportunities = this.getNodeParameter('includeOpportunities', i, false) as boolean;
					const companyIdAllowlistRaw = this.getNodeParameter('companyIdAllowlist', i, '') as string;
					const companyIds = parsePositiveIntCsv(companyIdAllowlistRaw, 'Company ID Allowlist');
					const dueWindowPreset = this.getNodeParameter('dueWindowPreset', i, '') as string;
					const dueBeforeCustom = this.getNodeParameter('dueBeforeCustom', i, '') as string;
					const dueBefore = resolveDueBeforeFromPreset(dueWindowPreset, dueBeforeCustom);
					const onlyOpenActive = this.getNodeParameter('onlyOpenActive', i, true) as boolean;
					const includeItemsWithNoDueDateInput = this.getNodeParameter('includeItemsWithNoDueDate', i, true) as boolean;
					const includeItemsWithNoDueDateExplicit = isParameterExplicitlySet(this, 'includeItemsWithNoDueDate');
					const includeItemsWithNoDueDate = includeItemsWithNoDueDateExplicit
						? includeItemsWithNoDueDateInput
						: dueBefore === null;
					const ticketAssignmentMode = this.getNodeParameter('ticketAssignmentMode', i, 'primaryOnly') as 'primaryOnly' | 'primaryAndSecondary';
					const projectReassignMode = this.getNodeParameter('projectReassignMode', i, 'leadAndTasks') as string;
					// Tasks and task secondary resources are included only via Include Projects + Project Reassign Mode
					const projectModeIncludesTasks = ['leadAndTasks', 'leadTasksAndSecondary', 'tasksOnly', 'tasksAndSecondary'].includes(projectReassignMode);
					const projectModeIncludesSecondary = ['leadTasksAndSecondary', 'tasksAndSecondary'].includes(projectReassignMode);
					const projectModeIncludesLead = ['leadOnly', 'leadAndTasks', 'leadTasksAndSecondary'].includes(projectReassignMode);
					const includeTasks = includeProjects && projectModeIncludesTasks;
					const includeTaskSecondaryResources = includeProjects && projectModeIncludesSecondary;
					const maxItemsPerEntity = Math.max(
						1,
						Math.trunc(this.getNodeParameter('maxItemsPerEntity', i, 500) as number),
					);
					const maxCompanies = Math.max(
						1,
						Math.trunc(this.getNodeParameter('maxCompanies', i, 500) as number),
					);
					const statusAllowlistByLabelRaw = this.getNodeParameter('statusAllowlistByLabel', i, '') as string;
					const statusAllowlistByValueRaw = this.getNodeParameter('statusAllowlistByValue', i, '') as string;
					const statusAllowlistByLabel = parseCsv(statusAllowlistByLabelRaw);
					const statusAllowlistByValue = parseStatusValueCsv(statusAllowlistByValueRaw);
					const addAuditNotes = this.getNodeParameter('addAuditNotes', i, false) as boolean;
					const auditNoteTemplate = this.getNodeParameter(
						'auditNoteTemplate',
						i,
						'Ownership transferred from {sourceResourceName} ({sourceResourceId}) to {destinationResourceName} ({destinationResourceId}) on {date}',
					) as string;
					const impersonationResourceId = getOptionalImpersonationResourceId(this, i);
					const proceedWithoutImpersonationIfDenied = this.getNodeParameter(
						'proceedWithoutImpersonationIfDenied',
						i,
						true,
					) as boolean;

					const options = {
						sourceResourceId,
						destinationResourceId,
						dryRun,
						includeTickets,
						includeTasks,
						includeProjects,
						includeTaskSecondaryResources,
						includeServiceCallAssignments,
						includeAppointments,
						includeCompanies,
						includeOpportunities,
						dueBefore,
						onlyOpenActive,
						includeItemsWithNoDueDate,
						ticketAssignmentMode,
						projectModeIncludesLead,
						maxItemsPerEntity,
						maxCompanies,
						addAuditNotes,
						auditNoteTemplate,
						proceedWithoutImpersonationIfDenied,
						...(companyIds.length > 0 && { companyIds }),
						...(statusAllowlistByLabel.length > 0 && { statusAllowlistByLabel }),
						...(statusAllowlistByValue.length > 0 && { statusAllowlistByValue }),
						...(impersonationResourceId !== undefined && { impersonationResourceId }),
					};

					const result = await transferOwnership(this, i, options);
					returnData.push({ json: result as unknown as IAutotaskEntity });
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
