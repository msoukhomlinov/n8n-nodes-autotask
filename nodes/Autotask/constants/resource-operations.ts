import { AUTOTASK_ENTITIES } from './entities';
import { OperationType } from '../types/base/entity-types';

const AI_OPERATION_ORDER = ['get', 'whoAmI', 'getMany', 'searchByDomain', 'getPosted', 'getUnposted', 'count', 'create', 'update', 'delete'] as const;
const EXCLUDED_TOP_LEVEL_RESOURCES = new Set(['tool', 'searchFilter']);

const OP_TYPE_TO_AI_OPS: Record<OperationType, string[]> = {
    [OperationType.CREATE]: ['create'],
    [OperationType.READ]: ['get'],
    [OperationType.UPDATE]: ['update'],
    [OperationType.DELETE]: ['delete'],
    [OperationType.QUERY]: ['get', 'getMany'],
    [OperationType.COUNT]: ['count'],
    [OperationType.GET_ENTITY_INFO]: [],
    [OperationType.GET_FIELD_INFO]: [],
};

const SPECIAL_AI_OPERATIONS: Record<string, string[]> = {
    resource: ['whoAmI'],
    company: ['searchByDomain'],
    timeEntry: ['getPosted', 'getUnposted'],
    aiHelper: ['describeResource', 'listPicklistValues', 'validateParameters'],
    apiThreshold: ['get'],
};

function lowerCamelCase(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function isAiExcludedEntity(name: string, isAttachment?: boolean, parentChain?: string[]): boolean {
    if (isAttachment) return true;
    if (EXCLUDED_TOP_LEVEL_RESOURCES.has(lowerCamelCase(name))) return true;
    if (!parentChain?.length) return false;
    return /(?:ExcludedResource|Field|UdfField)$/.test(name);
}

function toOrderedOperationList(ops: Set<string>): string[] {
    const ordered = AI_OPERATION_ORDER.filter((op) => ops.has(op));
    const remainder = [...ops].filter((op) => !AI_OPERATION_ORDER.includes(op as typeof AI_OPERATION_ORDER[number]));
    return [...ordered, ...remainder];
}

function buildResourceOperationsMap(): Record<string, string[]> {
    const map: Record<string, string[]> = {};

    for (const entity of AUTOTASK_ENTITIES) {
        if (isAiExcludedEntity(entity.name, entity.isAttachment, entity.parentChain)) {
            continue;
        }

        const resourceKey = entity.resourceKey ?? lowerCamelCase(entity.name);
        const ops = new Set<string>();

        for (const opType of Object.keys(entity.operations) as OperationType[]) {
            const mappedOperations = OP_TYPE_TO_AI_OPS[opType] ?? [];
            for (const mappedOperation of mappedOperations) {
                ops.add(mappedOperation);
            }
        }

        if (!ops.size) {
            continue;
        }

        const specialOps = SPECIAL_AI_OPERATIONS[resourceKey] ?? [];
        for (const specialOp of specialOps) {
            ops.add(specialOp);
        }

        map[resourceKey] = toOrderedOperationList(ops);
    }

    for (const [resourceKey, specialOps] of Object.entries(SPECIAL_AI_OPERATIONS)) {
        if (!map[resourceKey]) {
            map[resourceKey] = [...specialOps];
        }
    }

    return map;
}

export const RESOURCE_OPERATIONS_MAP: Record<string, string[]> = buildResourceOperationsMap();

const NORMALIZED_RESOURCE_OPERATIONS_MAP = Object.fromEntries(
    Object.entries(RESOURCE_OPERATIONS_MAP).map(([key, value]) => [key.toLowerCase(), value]),
);

const RESOURCE_ALIASES = AUTOTASK_ENTITIES.reduce<Record<string, string>>((aliases, entity) => {
    const defaultResourceKey = lowerCamelCase(entity.name);
    const resourceKey = entity.resourceKey ?? defaultResourceKey;
    if (defaultResourceKey.toLowerCase() !== resourceKey.toLowerCase()) {
        aliases[defaultResourceKey.toLowerCase()] = resourceKey;
    }
    return aliases;
}, {
    // Backward-compatible aliases not derivable from entity metadata.
    companysiteconfiguration: 'companySiteConfigurations',
    serviceLevelAgreementResult: 'serviceLevelAgreementResults',
    servicecallticketresources: 'serviceCallTicketResource',
    servicecalltaskresources: 'serviceCallTaskResource',
});

export function normaliseResourceName(resource: string): string {
    const trimmed = resource.trim();
    if (!trimmed) return resource;
    return RESOURCE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function getResourceOperations(resource: string): string[] {
    return NORMALIZED_RESOURCE_OPERATIONS_MAP[normaliseResourceName(resource).toLowerCase()] || [];
}
