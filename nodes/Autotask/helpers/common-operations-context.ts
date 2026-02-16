import { AUTOTASK_ENTITIES } from '../constants/entities';
import { normaliseResourceName } from '../constants/resource-operations';

function lowerCamelCase(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}

export interface ICommonOpContext {
    entityType: string;
    parentType?: string;
    parentChain?: string[];
}

function buildResourceToContextMap(): Map<string, ICommonOpContext> {
    const map = new Map<string, ICommonOpContext>();

    for (const entity of AUTOTASK_ENTITIES) {
        const defaultKey = lowerCamelCase(entity.name);
        const resourceKey = entity.resourceKey ?? defaultKey;
        const entityType = entity.name;
        const context: ICommonOpContext = {
            entityType,
        };

        if (entity.childOf) {
            context.parentType = lowerCamelCase(entity.childOf);
        }
        if (entity.parentChain?.length) {
            context.parentChain = entity.parentChain.map(p => lowerCamelCase(p));
        }
        const normalisedDefault = defaultKey.toLowerCase();
        const normalisedResource = resourceKey.toLowerCase();
        if (!map.has(normalisedDefault)) {
            map.set(normalisedDefault, context);
        }
        if (normalisedResource !== normalisedDefault && !map.has(normalisedResource)) {
            map.set(normalisedResource, context);
        }
    }

    return map;
}

const RESOURCE_TO_CONTEXT = buildResourceToContextMap();

/**
 * Resolve common-operation context for a node resource value.
 * Used by the central common-op handler in the main node and tool executor.
 *
 * @param resource - The resource parameter from the node (e.g. 'company', 'ticketChangeRequestApproval').
 * @returns Context for executing getEntityInfo, getFieldInfo, or getManyAdvanced, or undefined if not a known entity resource.
 */
export function getCommonOpContext(resource: string): ICommonOpContext | undefined {
    const normalised = normaliseResourceName(resource).toLowerCase();
    return RESOURCE_TO_CONTEXT.get(normalised);
}

/** Operation names that are handled by the central common-op layer. */
export const COMMON_OPERATIONS = ['getEntityInfo', 'getFieldInfo', 'getManyAdvanced'] as const;

export function isCommonOperation(operation: string): operation is (typeof COMMON_OPERATIONS)[number] {
    return (COMMON_OPERATIONS as readonly string[]).includes(operation);
}
