import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { getFieldOptions, getFilterFieldOptions, getSortFieldOptions, getQueryableEntities, getEntityFields } from './entityOptions';
import { getTicketStatuses, getTaskStatuses, getQueueOptions, getResourceOptions, getResourceOperations } from './picklistLoadOptions';

export {
	getFieldOptions,
	getFilterFieldOptions,
	getSortFieldOptions,
	getQueryableEntities,
	getEntityFields,
	getTicketStatuses,
	getTaskStatuses,
	getQueueOptions,
	getResourceOptions,
	getResourceOperations,
};

export type LoadOptionsFunction = (this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>;
export type EntityOptionsFunction = (entityType: string) => LoadOptionsFunction;
