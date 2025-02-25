import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { getFieldOptions, getFilterFieldOptions, getSortFieldOptions } from './entityOptions';

export {
	getFieldOptions,
	getFilterFieldOptions,
	getSortFieldOptions,
};

export type LoadOptionsFunction = (this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>;
export type EntityOptionsFunction = (entityType: string) => LoadOptionsFunction;
