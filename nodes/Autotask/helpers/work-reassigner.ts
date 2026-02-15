import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { getFields } from './entity/api';
import { buildEntityDeepLink } from './entity/deep-link';
import {
  withActiveImpersonationResource,
  withInactiveRefRetry,
} from './inactive-entity-activation';

type TransferEntityType =
  | 'ticket'
  | 'task'
  | 'project'
  | 'ticketSecondaryResource'
  | 'taskSecondaryResource'
  | 'serviceCallTicketResource'
  | 'serviceCallTaskResource'
  | 'appointment'
  | 'company'
  | 'opportunity';

export interface ITransferOwnershipOptions {
  sourceResourceId: number;
  destinationResourceId: number;
  dueBefore?: string | null;
  onlyOpenActive: boolean;
  dryRun: boolean;
  includeTickets: boolean;
  includeTasks: boolean;
  includeProjects: boolean;
  includeTaskSecondaryResources: boolean;
  includeServiceCallAssignments: boolean;
  includeAppointments: boolean;
  includeCompanies: boolean;
  includeOpportunities: boolean;
  includeItemsWithNoDueDate: boolean;
  ticketAssignmentMode: 'primaryOnly' | 'primaryAndSecondary';
  projectModeIncludesLead: boolean;
  maxItemsPerEntity: number;
  maxCompanies: number;
  companyIds?: number[];
  statusAllowlistByLabel?: string[];
  statusAllowlistByValue?: string[];
  addAuditNotes: boolean;
  auditNoteTemplate: string;
  impersonationResourceId?: number;
  proceedWithoutImpersonationIfDenied: boolean;
}

export interface IEntityFailure {
  entityType: TransferEntityType;
  id: number;
  error: string;
  retryable: boolean;
}

export interface ITransferOwnershipResult {
  runId: string;
  dryRun: boolean;
  summaryCounts: {
    ticketsPlanned: number;
    ticketsUpdated: number;
    ticketsFailed: number;
    tasksPlanned: number;
    tasksUpdated: number;
    tasksFailed: number;
    projectsPlanned: number;
    projectsUpdated: number;
    projectsFailed: number;
    ticketSecondaryResourcesPlanned: number;
    ticketSecondaryResourcesUpdated: number;
    ticketSecondaryResourcesFailed: number;
    taskSecondaryResourcesPlanned: number;
    taskSecondaryResourcesUpdated: number;
    taskSecondaryResourcesFailed: number;
    serviceCallTicketResourcesPlanned: number;
    serviceCallTicketResourcesUpdated: number;
    serviceCallTicketResourcesFailed: number;
    serviceCallTaskResourcesPlanned: number;
    serviceCallTaskResourcesUpdated: number;
    serviceCallTaskResourcesFailed: number;
    appointmentsPlanned: number;
    appointmentsUpdated: number;
    appointmentsFailed: number;
    companiesPlanned: number;
    companiesUpdated: number;
    companiesFailed: number;
    opportunitiesPlanned: number;
    opportunitiesUpdated: number;
    opportunitiesFailed: number;
  };
  plan?: {
    sourceResource: { id: number; name: string; isActive: boolean };
    destinationResource: { id: number; name: string; isActive: boolean };
    filters: {
      statusSetsUsed: Record<string, number[]>;
      dueBeforeTickets: string | null;
      dueBeforeTasksProjects: string | null;
    };
    tickets: IDataObject[];
    ticketSecondaryResources: IDataObject[];
    tasks: IDataObject[];
    taskSecondaryResources: IDataObject[];
    projects: IDataObject[];
    serviceCallTicketResources: IDataObject[];
    serviceCallTaskResources: IDataObject[];
    appointments: IDataObject[];
    companies: IDataObject[];
    opportunities: IDataObject[];
  };
  failures: IEntityFailure[];
  warnings: string[];
}

interface IDateCutoffs {
  dueBeforeRaw: string | null;
  dueBeforeTickets: string | null;
  dueBeforeTasksProjects: string | null;
}

const TERMINAL_STATUS_LABELS = new Set(['closed', 'complete', 'completed', 'done', 'inactive']);

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isActiveResource(item: IDataObject | undefined): boolean {
  if (!item) return false;
  const raw = item.isActive;
  return raw === true || raw === 1;
}

function getResourceDisplayName(item: IDataObject | undefined, fallbackId: number): string {
  if (!item) {
    return `Resource ${fallbackId}`;
  }

  const fullName = String(item.fullName ?? '').trim();
  if (fullName) {
    return fullName;
  }

  const firstName = String(item.firstName ?? '').trim();
  const lastName = String(item.lastName ?? '').trim();
  const combinedName = `${firstName} ${lastName}`.trim();
  if (combinedName) {
    return combinedName;
  }

  const userName = String(item.userName ?? '').trim();
  if (userName) {
    return userName;
  }

  return `Resource ${fallbackId}`;
}

function parseDueBefore(raw: string | null | undefined): IDateCutoffs {
  const dueBeforeRaw = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  if (!dueBeforeRaw) {
    return {
      dueBeforeRaw: null,
      dueBeforeTickets: null,
      dueBeforeTasksProjects: null,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dueBeforeRaw)) {
    return {
      dueBeforeRaw,
      dueBeforeTickets: `${dueBeforeRaw}T00:00:00Z`,
      dueBeforeTasksProjects: dueBeforeRaw,
    };
  }

  const parsed = new Date(dueBeforeRaw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Due cut-off is invalid. Use YYYY-MM-DD or a valid ISO-8601 datetime. Received: "${dueBeforeRaw}".`);
  }

  return {
    dueBeforeRaw,
    dueBeforeTickets: dueBeforeRaw,
    dueBeforeTasksProjects: dueBeforeRaw.slice(0, 10),
  };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function shouldIncludeByDueDate(
  value: unknown,
  entityType: 'ticket' | 'task' | 'project' | 'appointment',
  cutoffs: IDateCutoffs,
  includeItemsWithNoDueDate: boolean,
): boolean {
  if (!cutoffs.dueBeforeRaw) return true;
  if (value === undefined || value === null || String(value).trim() === '') {
    return includeItemsWithNoDueDate;
  }

  if (entityType === 'ticket' || entityType === 'appointment') {
    const due = new Date(String(value));
    if (Number.isNaN(due.getTime())) return false;

    if (/^\d{4}-\d{2}-\d{2}$/.test(cutoffs.dueBeforeRaw)) {
      const dayAfter = new Date(`${addDays(cutoffs.dueBeforeRaw, 1)}T00:00:00Z`);
      return due.getTime() < dayAfter.getTime();
    }

    const cut = new Date(cutoffs.dueBeforeRaw);
    return due.getTime() <= cut.getTime();
  }

  const dueDate = String(value).slice(0, 10);
  const cutoffDate = (cutoffs.dueBeforeTasksProjects ?? cutoffs.dueBeforeRaw).slice(0, 10);
  return dueDate <= cutoffDate;
}

function resolveTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

function isRetryableError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return text.includes('timeout') || text.includes('rate') || text.includes('tempor') || text.includes('retry');
}

async function queryAll(
  context: IExecuteFunctions,
  endpoint: string,
  filter: Array<{ field: string; op: string; value?: unknown }>,
): Promise<IDataObject[]> {
  const body: IDataObject = {
    filter,
    MaxRecords: 500,
  };
  const first = await autotaskApiRequest.call(context, 'POST', endpoint, body) as {
    items?: IDataObject[];
    pageDetails?: { nextPageUrl?: string | null };
  };
  const results: IDataObject[] = [...(first.items ?? [])];
  let nextPageUrl = first.pageDetails?.nextPageUrl;

  while (nextPageUrl) {
    const next = await autotaskApiRequest.call(context, 'POST', nextPageUrl, body) as {
      items?: IDataObject[];
      pageDetails?: { nextPageUrl?: string | null };
    };
    results.push(...(next.items ?? []));
    nextPageUrl = next.pageDetails?.nextPageUrl;
  }

  return results;
}

async function queryCount(
  context: IExecuteFunctions,
  endpoint: string,
  filter: Array<{ field: string; op: string; value?: unknown }>,
): Promise<number | null> {
  try {
    const response = await autotaskApiRequest.call(context, 'POST', endpoint, { filter }) as { queryCount?: number };
    return typeof response.queryCount === 'number' ? response.queryCount : null;
  } catch {
    return null;
  }
}

function getStatusValuesFromFields(
  fields: Array<IDataObject | Record<string, unknown>>,
  entityName: string,
  options: ITransferOwnershipOptions,
): { mode: 'in' | 'notIn' | 'none'; values: number[] } {
  const statusField = fields.find(
    (field) => String((field as IDataObject).name ?? '').toLowerCase() === 'status',
  ) as IDataObject | undefined;
  const rawPicklist = statusField?.picklistValues;
  const picklistValues = Array.isArray(rawPicklist) ? rawPicklist as IDataObject[] : [];

  if (picklistValues.length === 0) {
    return { mode: 'none', values: [] };
  }

  if (options.statusAllowlistByValue && options.statusAllowlistByValue.length > 0) {
    const allowed = new Set(options.statusAllowlistByValue.map((v) => Number.parseInt(v, 10)));
    const values = picklistValues
      .map((item) => asNumber(item.value))
      .filter((value): value is number => value !== null && allowed.has(value));
    if (values.length === 0) {
      throw new Error(`No ${entityName} statuses matched statusAllowlistByValue.`);
    }
    return { mode: 'in', values };
  }

  if (options.statusAllowlistByLabel && options.statusAllowlistByLabel.length > 0) {
    const labels = new Set(options.statusAllowlistByLabel.map((v) => v.trim().toLowerCase()));
    const values = picklistValues
      .filter((item) => labels.has(String(item.label ?? '').trim().toLowerCase()))
      .map((item) => asNumber(item.value))
      .filter((value): value is number => value !== null);
    if (values.length === 0) {
      throw new Error(`No ${entityName} statuses matched statusAllowlistByLabel.`);
    }
    return { mode: 'in', values };
  }

  const closedValues = picklistValues
    .filter((item) => TERMINAL_STATUS_LABELS.has(String(item.label ?? '').trim().toLowerCase()))
    .map((item) => asNumber(item.value))
    .filter((value): value is number => value !== null);

  if (closedValues.length === 0) {
    throw new Error(`Unable to resolve closed/terminal statuses for ${entityName}. Provide explicit allowlists.`);
  }

  return { mode: 'notIn', values: closedValues };
}

function buildStatusFilter(fieldName: string, mode: 'in' | 'notIn' | 'none', values: number[]): Array<{ field: string; op: string; value?: unknown }> {
  if (mode === 'none') return [];
  return [{ field: fieldName, op: mode, value: values }];
}

function ensureBelowLimit(results: IDataObject[], limit: number, entityLabel: string): void {
  if (results.length > limit) {
    throw new Error(
      `Found \u2265${results.length} ${entityLabel}. Exceeds maxItemsPerEntity (${limit}). Narrow your filters (add due window, reduce scope) or increase maxItemsPerEntity.`,
    );
  }
}

function toFailure(entityType: TransferEntityType, id: number, error: unknown): IEntityFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    entityType,
    id,
    error: message,
    retryable: isRetryableError(error),
  };
}

async function addAuditNote(
  context: IExecuteFunctions,
  entityType: 'ticket' | 'task' | 'project' | 'company',
  entityId: number,
  description: string,
  impersonationResourceId: number | undefined,
  proceedWithoutImpersonationIfDenied: boolean,
  warnings: string[],
): Promise<void> {
  try {
    if (entityType === 'company') {
      await autotaskApiRequest.call(context, 'POST', 'CompanyNotes/', {
        id: 0,
        companyID: entityId,
        title: 'Ownership Transferred',
        description,
      }, {}, impersonationResourceId, proceedWithoutImpersonationIfDenied);
      return;
    }

    if (entityType === 'ticket') {
      await autotaskApiRequest.call(context, 'POST', 'TicketNotes/', {
        id: 0,
        ticketID: entityId,
        title: 'Ownership Transferred',
        description,
        noteType: 1,
        publish: 1,
      }, {}, impersonationResourceId, proceedWithoutImpersonationIfDenied);
      return;
    }

    if (entityType === 'project') {
      await autotaskApiRequest.call(context, 'POST', 'ProjectNotes/', {
        id: 0,
        projectID: entityId,
        title: 'Ownership Transferred',
        description,
        noteType: 1,
        publish: 1,
      }, {}, impersonationResourceId, proceedWithoutImpersonationIfDenied);
      return;
    }

    try {
      await autotaskApiRequest.call(context, 'POST', `Tasks/${entityId}/Notes/`, {
        id: 0,
        title: 'Ownership Transferred',
        description,
        noteType: 1,
        publish: 1,
      }, {}, impersonationResourceId, proceedWithoutImpersonationIfDenied);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404') || message.includes('405')) {
        warnings.push(`Task notes endpoint not supported; task ${entityId} audit note skipped.`);
        return;
      }
      throw error;
    }
  } catch (error) {
    warnings.push(`Failed to add ${entityType} audit note for ${entityId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function transferOwnership(
  context: IExecuteFunctions,
  _itemIndex: number,
  options: ITransferOwnershipOptions,
): Promise<ITransferOwnershipResult> {
  const warnings: string[] = [];
  const failures: IEntityFailure[] = [];
  const runId = `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cutoffs = parseDueBefore(options.dueBefore);

  const source = await autotaskApiRequest.call(context, 'GET', `Resources/${options.sourceResourceId}/`) as { item?: IDataObject };
  if (!source.item) {
    throw new Error(`Source resource ${options.sourceResourceId} was not found.`);
  }

  const destination = await autotaskApiRequest.call(context, 'GET', `Resources/${options.destinationResourceId}/`) as { item?: IDataObject };
  if (!destination.item) {
    throw new Error(`Receiving resource ${options.destinationResourceId} was not found.`);
  }
  if (!isActiveResource(destination.item)) {
    throw new Error(`Receiving resource ${options.destinationResourceId} is inactive. Select an active receiving resource.`);
  }
  const sourceResourceName = getResourceDisplayName(source.item, options.sourceResourceId);
  const destinationResourceName = getResourceDisplayName(destination.item, options.destinationResourceId);

  const [ticketFields, taskFields, projectFields, opportunityFields] = await Promise.all([
    getFields('Ticket', context) as unknown as Promise<Array<IDataObject | Record<string, unknown>>>,
    getFields('Task', context) as unknown as Promise<Array<IDataObject | Record<string, unknown>>>,
    getFields('Project', context) as unknown as Promise<Array<IDataObject | Record<string, unknown>>>,
    getFields('Opportunity', context) as unknown as Promise<Array<IDataObject | Record<string, unknown>>>,
  ]);
  const ticketStatusFilter = getStatusValuesFromFields(ticketFields, 'Ticket', options);
  const taskStatusFilter = getStatusValuesFromFields(taskFields, 'Task', options);
  const projectStatusFilter = getStatusValuesFromFields(projectFields, 'Project', options);
  const opportunityStatusFilter = getStatusValuesFromFields(opportunityFields, 'Opportunity', options);

  const statusSetsUsed: Record<string, number[]> = {
    ticket: ticketStatusFilter.values,
    task: taskStatusFilter.values,
    project: projectStatusFilter.values,
    opportunity: opportunityStatusFilter.values,
  };

  const summary: ITransferOwnershipResult['summaryCounts'] = {
    ticketsPlanned: 0,
    ticketsUpdated: 0,
    ticketsFailed: 0,
    ticketSecondaryResourcesPlanned: 0,
    ticketSecondaryResourcesUpdated: 0,
    ticketSecondaryResourcesFailed: 0,
    tasksPlanned: 0,
    tasksUpdated: 0,
    tasksFailed: 0,
    projectsPlanned: 0,
    projectsUpdated: 0,
    projectsFailed: 0,
    taskSecondaryResourcesPlanned: 0,
    taskSecondaryResourcesUpdated: 0,
    taskSecondaryResourcesFailed: 0,
    serviceCallTicketResourcesPlanned: 0,
    serviceCallTicketResourcesUpdated: 0,
    serviceCallTicketResourcesFailed: 0,
    serviceCallTaskResourcesPlanned: 0,
    serviceCallTaskResourcesUpdated: 0,
    serviceCallTaskResourcesFailed: 0,
    appointmentsPlanned: 0,
    appointmentsUpdated: 0,
    appointmentsFailed: 0,
    companiesPlanned: 0,
    companiesUpdated: 0,
    companiesFailed: 0,
    opportunitiesPlanned: 0,
    opportunitiesUpdated: 0,
    opportunitiesFailed: 0,
  };

  let companies: IDataObject[] = [];
  let scopedCompanyIds: number[] = [];

  if (options.includeCompanies) {
    if (Array.isArray(options.companyIds) && options.companyIds.length > 0) {
      const uniqueCompanyIds = [...new Set(options.companyIds)];
      companies = await queryAll(context, 'Companies/query/', [
        { field: 'id', op: 'in', value: uniqueCompanyIds },
      ]);
      const foundCompanyIds = new Set(
        companies
          .map((company) => asNumber(company.id))
          .filter((id): id is number => id !== null),
      );
      const missingCompanyIds = uniqueCompanyIds.filter((id) => !foundCompanyIds.has(id));
      if (missingCompanyIds.length > 0) {
        throw new Error(`Some companies in company allowlist were not found: ${missingCompanyIds.join(', ')}`);
      }
    } else {
      companies = await queryAll(context, 'Companies/query/', [
        { field: 'ownerResourceID', op: 'eq', value: options.sourceResourceId },
        { field: 'isActive', op: 'eq', value: true },
      ]);
    }

    ensureBelowLimit(companies, options.maxCompanies, 'companies');
    summary.companiesPlanned = companies.length;
    scopedCompanyIds = companies
      .map((company) => asNumber(company.id))
      .filter((id): id is number => id !== null);
  }

  const companyScopeFilter = options.includeCompanies
    ? (scopedCompanyIds.length > 0 ? [{ field: 'companyID', op: 'in', value: scopedCompanyIds }] : [])
    : [];

  const ticketFilters: Array<{ field: string; op: string; value?: unknown }> = [
    { field: 'assignedResourceID', op: 'eq', value: options.sourceResourceId },
    ...companyScopeFilter,
    ...(options.onlyOpenActive ? buildStatusFilter('status', ticketStatusFilter.mode, ticketStatusFilter.values) : []),
    ...(cutoffs.dueBeforeRaw && !options.includeItemsWithNoDueDate
      ? [{
        field: 'dueDateTime',
        op: 'lt',
        value: /^\d{4}-\d{2}-\d{2}$/.test(cutoffs.dueBeforeRaw)
          ? `${addDays(cutoffs.dueBeforeRaw, 1)}T00:00:00Z`
          : cutoffs.dueBeforeRaw,
      }, { field: 'dueDateTime', op: 'exist' }]
      : []),
  ];
  const taskFilters: Array<{ field: string; op: string; value?: unknown }> = [
    { field: 'assignedResourceID', op: 'eq', value: options.sourceResourceId },
    ...companyScopeFilter,
    ...(options.onlyOpenActive ? buildStatusFilter('status', taskStatusFilter.mode, taskStatusFilter.values) : []),
    ...(cutoffs.dueBeforeRaw && !options.includeItemsWithNoDueDate
      ? [{ field: 'endDateTime', op: 'lt', value: addDays((cutoffs.dueBeforeTasksProjects ?? cutoffs.dueBeforeRaw).slice(0, 10), 1) }, { field: 'endDateTime', op: 'exist' }]
      : []),
  ];
  const projectFilters: Array<{ field: string; op: string; value?: unknown }> = [
    { field: 'projectLeadResourceID', op: 'eq', value: options.sourceResourceId },
    ...companyScopeFilter,
    ...(options.onlyOpenActive ? buildStatusFilter('status', projectStatusFilter.mode, projectStatusFilter.values) : []),
    ...(cutoffs.dueBeforeRaw && !options.includeItemsWithNoDueDate
      ? [{ field: 'endDateTime', op: 'lt', value: addDays((cutoffs.dueBeforeTasksProjects ?? cutoffs.dueBeforeRaw).slice(0, 10), 1) }, { field: 'endDateTime', op: 'exist' }]
      : []),
  ];

  const hasCompanyScopeWithoutMatches = options.includeCompanies && scopedCompanyIds.length === 0;
  const ticketsRaw = options.includeTickets
    ? (hasCompanyScopeWithoutMatches ? [] : await queryAll(context, 'Tickets/query/', ticketFilters))
    : [];
  const tasksRaw = options.includeTasks
    ? (hasCompanyScopeWithoutMatches ? [] : await queryAll(context, 'Tasks/query/', taskFilters))
    : [];
  const projectsRaw = options.includeProjects
    ? (hasCompanyScopeWithoutMatches ? [] : await queryAll(context, 'Projects/query/', projectFilters))
    : [];

  const tickets = ticketsRaw.filter((ticket) =>
    shouldIncludeByDueDate(ticket.dueDateTime, 'ticket', cutoffs, options.includeItemsWithNoDueDate),
  );
  const tasks = tasksRaw.filter((task) =>
    shouldIncludeByDueDate(task.endDateTime, 'task', cutoffs, options.includeItemsWithNoDueDate),
  );
  const projects = projectsRaw.filter((project) =>
    shouldIncludeByDueDate(project.endDateTime, 'project', cutoffs, options.includeItemsWithNoDueDate),
  );

  ensureBelowLimit(tickets, options.maxItemsPerEntity, 'tickets');
  ensureBelowLimit(tasks, options.maxItemsPerEntity, 'tasks');
  ensureBelowLimit(projects, options.maxItemsPerEntity, 'projects');

  summary.ticketsPlanned = tickets.length;
  summary.tasksPlanned = tasks.length;
  summary.projectsPlanned = projects.length;

  const ticketIds = new Set(tickets.map((ticket) => asNumber(ticket.id)).filter((id): id is number => id !== null));

  // Standalone ticket secondary resources: tickets where source is ONLY a secondary,
  // excluding tickets already in the primary ticket set (those are handled inline).
  const ticketSecondaryRaw = (options.includeTickets && options.ticketAssignmentMode === 'primaryAndSecondary')
    ? await queryAll(context, 'TicketSecondaryResources/query/', [{ field: 'resourceID', op: 'eq', value: options.sourceResourceId }])
    : [];
  const ticketSecondaryResources = ticketSecondaryRaw.filter((item) => {
    const tId = asNumber(item.ticketID);
    // Exclude rows for tickets already in the primary set — those are handled inline
    return tId !== null && !ticketIds.has(tId);
  });
  ensureBelowLimit(ticketSecondaryResources, options.maxItemsPerEntity, 'ticket secondary resources');
  summary.ticketSecondaryResourcesPlanned = ticketSecondaryResources.length;

  const taskIds = new Set(tasks.map((task) => asNumber(task.id)).filter((id): id is number => id !== null));

  const taskSecondaryRaw = options.includeTaskSecondaryResources
    ? await queryAll(context, 'TaskSecondaryResources/query/', [{ field: 'resourceID', op: 'eq', value: options.sourceResourceId }])
    : [];
  const taskSecondaryResources = taskSecondaryRaw.filter((item) => {
    if (taskIds.size === 0 || !options.includeTasks) return true;
    const taskId = asNumber(item.taskID);
    return taskId !== null && taskIds.has(taskId);
  });
  ensureBelowLimit(taskSecondaryResources, options.maxItemsPerEntity, 'task secondary resources');
  summary.taskSecondaryResourcesPlanned = taskSecondaryResources.length;

  const serviceCallTicketResources = options.includeServiceCallAssignments
    ? await queryAll(context, 'ServiceCallTicketResources/query/', [{ field: 'resourceID', op: 'eq', value: options.sourceResourceId }])
    : [];
  const serviceCallTaskResources = options.includeServiceCallAssignments
    ? await queryAll(context, 'ServiceCallTaskResources/query/', [{ field: 'resourceID', op: 'eq', value: options.sourceResourceId }])
    : [];
  ensureBelowLimit(serviceCallTicketResources, options.maxItemsPerEntity, 'service call ticket resources');
  ensureBelowLimit(serviceCallTaskResources, options.maxItemsPerEntity, 'service call task resources');
  summary.serviceCallTicketResourcesPlanned = serviceCallTicketResources.length;
  summary.serviceCallTaskResourcesPlanned = serviceCallTaskResources.length;

  const appointmentFilters: Array<{ field: string; op: string; value?: unknown }> = [
    { field: 'resourceID', op: 'eq', value: options.sourceResourceId },
    ...companyScopeFilter,
    ...(cutoffs.dueBeforeRaw && !options.includeItemsWithNoDueDate ? [{ field: 'endDateTime', op: 'exist' }] : []),
  ];
  const appointmentsRaw = options.includeAppointments
    ? (hasCompanyScopeWithoutMatches ? [] : await queryAll(context, 'Appointments/query/', appointmentFilters))
    : [];
  const appointments = appointmentsRaw.filter((appointment) =>
    shouldIncludeByDueDate(appointment.endDateTime, 'appointment', cutoffs, options.includeItemsWithNoDueDate),
  );
  ensureBelowLimit(appointments, options.maxItemsPerEntity, 'appointments');
  summary.appointmentsPlanned = appointments.length;

  const opportunityFilters: Array<{ field: string; op: string; value?: unknown }> = [
    { field: 'ownerResourceID', op: 'eq', value: options.sourceResourceId },
    ...(options.onlyOpenActive
      ? buildStatusFilter('status', opportunityStatusFilter.mode, opportunityStatusFilter.values)
      : []),
    ...companyScopeFilter,
  ];
  const opportunities = options.includeOpportunities
    ? (hasCompanyScopeWithoutMatches ? [] : await queryAll(context, 'Opportunities/query/', opportunityFilters))
    : [];
  ensureBelowLimit(opportunities, options.maxItemsPerEntity, 'opportunities');
  summary.opportunitiesPlanned = opportunities.length;

  if (options.dryRun) {
    return {
      runId,
      dryRun: true,
      summaryCounts: summary,
      plan: {
        sourceResource: {
          id: options.sourceResourceId,
          name: sourceResourceName,
          isActive: isActiveResource(source.item),
        },
        destinationResource: {
          id: options.destinationResourceId,
          name: destinationResourceName,
          isActive: true,
        },
        filters: {
          statusSetsUsed,
          dueBeforeTickets: cutoffs.dueBeforeTickets,
          dueBeforeTasksProjects: cutoffs.dueBeforeTasksProjects,
        },
        tickets: tickets.map((item) => ({
          id: item.id,
          ticketNumber: item.ticketNumber,
          title: item.title,
          dueDateTime: item.dueDateTime,
          assignedResourceID: item.assignedResourceID,
          companyID: item.companyID,
          status: item.status,
        })),
        ticketSecondaryResources: ticketSecondaryResources.map((item) => ({
          id: item.id,
          ticketID: item.ticketID,
          resourceID: item.resourceID,
          roleID: item.roleID,
        })),
        tasks: tasks.map((item) => ({
          id: item.id,
          taskNumber: item.taskNumber,
          title: item.title,
          endDateTime: item.endDateTime,
          assignedResourceID: item.assignedResourceID,
          projectID: item.projectID,
          billingCodeID: item.billingCodeID,
          status: item.status,
        })),
        taskSecondaryResources: taskSecondaryResources.map((item) => ({
          id: item.id,
          taskID: item.taskID,
          resourceID: item.resourceID,
          roleID: item.roleID,
        })),
        projects: projects.map((item) => ({
          id: item.id,
          projectNumber: item.projectNumber,
          projectName: item.projectName,
          endDateTime: item.endDateTime,
          projectLeadResourceID: item.projectLeadResourceID,
          companyID: item.companyID,
          status: item.status,
        })),
        serviceCallTicketResources: serviceCallTicketResources.map((item) => ({
          id: item.id,
          serviceCallTicketID: item.serviceCallTicketID,
          resourceID: item.resourceID,
        })),
        serviceCallTaskResources: serviceCallTaskResources.map((item) => ({
          id: item.id,
          serviceCallTaskID: item.serviceCallTaskID,
          resourceID: item.resourceID,
        })),
        appointments: appointments.map((item) => ({
          id: item.id,
          title: item.title,
          startDateTime: item.startDateTime,
          endDateTime: item.endDateTime,
          resourceID: item.resourceID,
          companyID: item.companyID,
        })),
        companies: companies.map((item) => ({
          id: item.id,
          companyName: item.companyName,
          ownerResourceID: item.ownerResourceID,
          isActive: item.isActive,
        })),
        opportunities: opportunities.map((item) => ({
          id: item.id,
          title: item.title,
          companyID: item.companyID,
          ownerResourceID: item.ownerResourceID,
          status: item.status,
          amount: item.amount,
        })),
      },
      failures,
      warnings,
    };
  }

  await withActiveImpersonationResource(
    context,
    options.impersonationResourceId,
    warnings,
    async () => {
      for (const company of companies) {
        const companyId = asNumber(company.id) ?? 0;
        try {
          await withInactiveRefRetry(context, warnings, async () => {
            await autotaskApiRequest.call(context, 'PATCH', 'Companies/', {
              id: companyId,
              ownerResourceID: options.destinationResourceId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          });
          summary.companiesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('company', companyId, error));
          summary.companiesFailed += 1;
        }
      }

      for (const ticket of tickets) {
        const ticketId = asNumber(ticket.id) ?? 0;
        try {
          await withInactiveRefRetry(context, warnings, async () => {
            await autotaskApiRequest.call(context, 'PATCH', 'Tickets/', {
              id: ticketId,
              assignedResourceID: options.destinationResourceId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          });
          summary.ticketsUpdated += 1;
        } catch (error) {
          failures.push(toFailure('ticket', ticketId, error));
          summary.ticketsFailed += 1;
          continue;
        }

        if (options.ticketAssignmentMode === 'primaryAndSecondary') {
          try {
            const secondaryRows = await queryAll(context, 'TicketSecondaryResources/query/', [
              { field: 'resourceID', op: 'eq', value: options.sourceResourceId },
              { field: 'ticketID', op: 'eq', value: ticketId },
            ]);
            for (const row of secondaryRows) {
              const rowId = asNumber(row.id) ?? 0;
              const roleId = asNumber(row.roleID);
              if (!roleId) continue;
              // We just reassigned the primary to the destination — creating a secondary
              // for the destination on this same ticket would conflict. Just clear it.
              await autotaskApiRequest.call(context, 'DELETE', `TicketSecondaryResources/${rowId}/`, {}, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
              warnings.push(`Ticket ${ticketId}: secondary assignment for source resource cleared (destination is now primary).`);
            }
          } catch (error) {
            failures.push(toFailure('ticketSecondaryResource', ticketId, error));
          }
        }
      }

      // Standalone ticket secondary resources (tickets where source is secondary-only)
      for (const row of ticketSecondaryResources) {
        const rowId = asNumber(row.id) ?? 0;
        const tktId = asNumber(row.ticketID) ?? 0;
        const roleId = asNumber(row.roleID);
        if (!roleId) {
          warnings.push(`Ticket secondary resource ${rowId} has no roleID and was skipped.`);
          continue;
        }
        try {
          // Check if destination is already the primary on this ticket
          const ticketResponse = await autotaskApiRequest.call(context, 'GET', `Tickets/${tktId}/`) as { item?: IDataObject };
          const destIsPrimary = ticketResponse.item
            ? asNumber(ticketResponse.item.assignedResourceID) === options.destinationResourceId
            : false;

          await autotaskApiRequest.call(context, 'DELETE', `TicketSecondaryResources/${rowId}/`, {}, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          if (destIsPrimary) {
            warnings.push(`Ticket ${tktId}: secondary assignment for source resource cleared (destination is already primary).`);
          } else {
            await autotaskApiRequest.call(context, 'POST', 'TicketSecondaryResources/', {
              id: 0,
              ticketID: tktId,
              resourceID: options.destinationResourceId,
              roleID: roleId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          }
          summary.ticketSecondaryResourcesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('ticketSecondaryResource', rowId, error));
          summary.ticketSecondaryResourcesFailed += 1;
        }
      }

      for (const task of tasks) {
        const taskId = asNumber(task.id) ?? 0;
        const billingCodeId = asNumber(task.billingCodeID);
        if (billingCodeId === null) {
          warnings.push(`Task ${taskId}: billingCodeID missing, PATCH may be rejected by API.`);
        }
        try {
          await withInactiveRefRetry(context, warnings, async () => {
            await autotaskApiRequest.call(context, 'PATCH', 'Tasks/', {
              id: taskId,
              assignedResourceID: options.destinationResourceId,
              billingCodeID: billingCodeId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          });
          summary.tasksUpdated += 1;
        } catch (error) {
          failures.push(toFailure('task', taskId, error));
          summary.tasksFailed += 1;
        }
      }

      if (options.projectModeIncludesLead) {
        for (const project of projects) {
          const projectId = asNumber(project.id) ?? 0;
          try {
            await withInactiveRefRetry(context, warnings, async () => {
              await autotaskApiRequest.call(context, 'PATCH', 'Projects/', {
                id: projectId,
                projectLeadResourceID: options.destinationResourceId,
              }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
            });
            summary.projectsUpdated += 1;
          } catch (error) {
            failures.push(toFailure('project', projectId, error));
            summary.projectsFailed += 1;
          }
        }
      }

      for (const row of taskSecondaryResources) {
        const rowId = asNumber(row.id) ?? 0;
        const taskId = asNumber(row.taskID) ?? 0;
        const roleId = asNumber(row.roleID);
        if (!roleId) {
          warnings.push(`Task secondary resource ${rowId} has no roleID and was skipped.`);
          continue;
        }
        try {
          // Check if destination is the primary assignee on this task
          const parentTask = tasks.find((t) => asNumber(t.id) === taskId);
          const destIsPrimary = parentTask
            ? asNumber(parentTask.assignedResourceID) === options.destinationResourceId
            : taskIds.has(taskId); // task was just reassigned to destination

          await autotaskApiRequest.call(context, 'DELETE', `TaskSecondaryResources/${rowId}/`, {}, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          if (destIsPrimary) {
            warnings.push(`Task ${taskId}: secondary assignment for source resource cleared (destination is already primary).`);
          } else {
            await autotaskApiRequest.call(context, 'POST', 'TaskSecondaryResources/', {
              id: 0,
              taskID: taskId,
              resourceID: options.destinationResourceId,
              roleID: roleId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          }
          summary.taskSecondaryResourcesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('taskSecondaryResource', rowId, error));
          summary.taskSecondaryResourcesFailed += 1;
        }
      }

      for (const row of serviceCallTicketResources) {
        const rowId = asNumber(row.id) ?? 0;
        const serviceCallTicketId = asNumber(row.serviceCallTicketID) ?? 0;
        try {
          await autotaskApiRequest.call(context, 'DELETE', `ServiceCallTicketResources/${rowId}/`, {}, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          await autotaskApiRequest.call(context, 'POST', 'ServiceCallTicketResources/', {
            id: 0,
            serviceCallTicketID: serviceCallTicketId,
            resourceID: options.destinationResourceId,
          }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          summary.serviceCallTicketResourcesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('serviceCallTicketResource', rowId, error));
          summary.serviceCallTicketResourcesFailed += 1;
        }
      }

      for (const row of serviceCallTaskResources) {
        const rowId = asNumber(row.id) ?? 0;
        const serviceCallTaskId = asNumber(row.serviceCallTaskID) ?? 0;
        try {
          await autotaskApiRequest.call(context, 'DELETE', `ServiceCallTaskResources/${rowId}/`, {}, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          await autotaskApiRequest.call(context, 'POST', 'ServiceCallTaskResources/', {
            id: 0,
            serviceCallTaskID: serviceCallTaskId,
            resourceID: options.destinationResourceId,
          }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          summary.serviceCallTaskResourcesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('serviceCallTaskResource', rowId, error));
          summary.serviceCallTaskResourcesFailed += 1;
        }
      }

      for (const appointment of appointments) {
        const appointmentId = asNumber(appointment.id) ?? 0;
        try {
          await autotaskApiRequest.call(context, 'PATCH', 'Appointments/', {
            id: appointmentId,
            resourceID: options.destinationResourceId,
          }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          summary.appointmentsUpdated += 1;
        } catch (error) {
          failures.push(toFailure('appointment', appointmentId, error));
          summary.appointmentsFailed += 1;
        }
      }

      for (const opportunity of opportunities) {
        const opportunityId = asNumber(opportunity.id) ?? 0;
        try {
          await withInactiveRefRetry(context, warnings, async () => {
            await autotaskApiRequest.call(context, 'PATCH', 'Opportunities/', {
              id: opportunityId,
              ownerResourceID: options.destinationResourceId,
            }, {}, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied);
          });
          summary.opportunitiesUpdated += 1;
        } catch (error) {
          failures.push(toFailure('opportunity', opportunityId, error));
          summary.opportunitiesFailed += 1;
        }
      }

      if (options.addAuditNotes) {
        const date = toIsoDate(new Date());
        for (const company of companies) {
          const companyId = asNumber(company.id) ?? 0;
          if (failures.some((f) => f.entityType === 'company' && f.id === companyId)) continue;
          const link = await buildEntityDeepLink(context, 'company', companyId) ?? '';
          const note = resolveTemplate(options.auditNoteTemplate, {
            sourceResourceId: options.sourceResourceId,
            destinationResourceId: options.destinationResourceId,
            sourceResourceName,
            destinationResourceName,
            date,
            entityType: 'company',
            entityId: companyId,
            entityLink: link,
          });
          await addAuditNote(context, 'company', companyId, note, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied, warnings);
        }

        for (const ticket of tickets) {
          const ticketId = asNumber(ticket.id) ?? 0;
          if (failures.some((f) => f.entityType === 'ticket' && f.id === ticketId)) continue;
          const link = await buildEntityDeepLink(context, 'ticket', ticketId) ?? '';
          const note = resolveTemplate(options.auditNoteTemplate, {
            sourceResourceId: options.sourceResourceId,
            destinationResourceId: options.destinationResourceId,
            sourceResourceName,
            destinationResourceName,
            date,
            entityType: 'ticket',
            entityId: ticketId,
            entityLink: link,
          });
          await addAuditNote(context, 'ticket', ticketId, note, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied, warnings);
        }

        for (const task of tasks) {
          const taskId = asNumber(task.id) ?? 0;
          if (failures.some((f) => f.entityType === 'task' && f.id === taskId)) continue;
          const link = await buildEntityDeepLink(context, 'task', taskId) ?? '';
          const note = resolveTemplate(options.auditNoteTemplate, {
            sourceResourceId: options.sourceResourceId,
            destinationResourceId: options.destinationResourceId,
            sourceResourceName,
            destinationResourceName,
            date,
            entityType: 'task',
            entityId: taskId,
            entityLink: link,
          });
          await addAuditNote(context, 'task', taskId, note, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied, warnings);
        }

        for (const project of projects) {
          const projectId = asNumber(project.id) ?? 0;
          if (failures.some((f) => f.entityType === 'project' && f.id === projectId)) continue;
          const link = await buildEntityDeepLink(context, 'project', projectId) ?? '';
          const note = resolveTemplate(options.auditNoteTemplate, {
            sourceResourceId: options.sourceResourceId,
            destinationResourceId: options.destinationResourceId,
            sourceResourceName,
            destinationResourceName,
            date,
            entityType: 'project',
            entityId: projectId,
            entityLink: link,
          });
          await addAuditNote(context, 'project', projectId, note, options.impersonationResourceId, options.proceedWithoutImpersonationIfDenied, warnings);
        }
      }
    },
  );

  const ticketCount = await queryCount(context, 'Tickets/query/count/', ticketFilters);
  if (ticketCount !== null && ticketCount > options.maxItemsPerEntity) {
    warnings.push(`Ticket query count is ${ticketCount}, which is above maxItemsPerEntity.`);
  }

  return {
    runId,
    dryRun: false,
    summaryCounts: summary,
    failures,
    warnings,
  };
}
