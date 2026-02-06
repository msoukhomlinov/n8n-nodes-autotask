import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { initializeCache } from '../cache/init';
import { EntityValueHelper } from '../entity-values';
import { getResourcesForExclusion } from '../webhook/resources';
import { getResourceOperations as getResourceOpsForEntity } from '../../constants/resource-operations';

/**
 * Get picklist values for Tickets.status.
 * Uses EntityValueHelper with CacheService so values are served from cache
 * when available instead of polling the Autotask API on every load.
 */
export async function getTicketStatuses(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  try {
    const cacheService = await initializeCache(this);
    const helper = new EntityValueHelper<IAutotaskEntity>(this, 'Tickets', { cacheService });
    const values = await helper.getPicklistValues('status');
    return values
      .filter((v) => v.isActive)
      .map((v) => ({
        name: v.label || `Status ${v.value}`,
        value: v.value,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error loading ticket statuses:', (error as Error).message);
    return [];
  }
}

/**
 * Get picklist values for Tasks.status.
 * Uses EntityValueHelper with CacheService so values are served from cache
 * when available instead of polling the Autotask API on every load.
 */
export async function getTaskStatuses(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  try {
    const cacheService = await initializeCache(this);
    const helper = new EntityValueHelper<IAutotaskEntity>(this, 'Tasks', { cacheService });
    const values = await helper.getPicklistValues('status');
    return values
      .filter((v) => v.isActive)
      .map((v) => ({
        name: v.label || `Status ${v.value}`,
        value: v.value,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error loading task statuses:', (error as Error).message);
    return [];
  }
}

/**
 * Get picklist values for Tickets.queueID.
 * Uses EntityValueHelper with CacheService so values are served from cache
 * when available instead of polling the Autotask API on every load.
 */
export async function getQueueOptions(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  try {
    const cacheService = await initializeCache(this);
    const helper = new EntityValueHelper<IAutotaskEntity>(this, 'Tickets', { cacheService });
    const values = await helper.getPicklistValues('queueID');
    const sorted = values
      .filter((v) => v.isActive)
      .map((v) => ({
        name: v.label || `Queue ${v.value}`,
        value: v.value,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ name: 'All Queues', value: '' }, ...sorted];
  } catch (error) {
    console.error('Error loading queue options:', (error as Error).message);
    return [{ name: 'All Queues', value: '' }];
  }
}

/**
 * Get active Resources (technicians) for dropdown selection.
 * Delegates to getResourcesForExclusion which already uses CacheService.
 */
export async function getResourceOptions(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  try {
    const resources = await getResourcesForExclusion.call(this);
    const sorted = resources
      .map((r) => ({
        name: r.name,
        value: String(r.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ name: 'All Resources', value: '' }, ...sorted];
  } catch (error) {
    console.error('Error loading resources:', (error as Error).message);
    return [{ name: 'All Resources', value: '' }];
  }
}

/**
 * Get available operations for a target resource (used by tool resource).
 * Pure in-memory map lookup -- no API call, no caching required.
 */
export async function getResourceOperations(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const targetResource = this.getNodeParameter('targetResource', 0) as string;

  if (!targetResource) {
    return [];
  }

  const operations = getResourceOpsForEntity(targetResource);

  return operations.map((op) => ({
    name: op.charAt(0).toUpperCase() + op.slice(1),
    value: op,
    description: `${op} operation for ${targetResource}`,
  }));
}
