import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { getFieldOptions, getFilterFieldOptions, getSortFieldOptions, getQueryableEntities, getEntityFields } from './entityOptions';

export {
	getFieldOptions,
	getFilterFieldOptions,
	getSortFieldOptions,
	getQueryableEntities,
	getEntityFields,
};

export type LoadOptionsFunction = (this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>;
export type EntityOptionsFunction = (entityType: string) => LoadOptionsFunction;
