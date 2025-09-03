import type { INodePropertyOptions } from 'n8n-workflow';
import { AUTOTASK_ENTITIES } from './entities';
import { getResourceOperations } from './resource-operations';

/**
 * Static tool surface for AI enumeration
 * Provides predefined resource-operation combinations that AI agents can discover upfront
 */

/**
 * Generate static resource-operation combinations for AI tool enumeration
 */
function generateToolOperations(): INodePropertyOptions[] {
    const operations: INodePropertyOptions[] = [];

    // Iterate through all entities that support operations
    AUTOTASK_ENTITIES.forEach(entity => {
        const entityOperations = getResourceOperations(entity.name);

        // Create operation combinations for this entity
        entityOperations.forEach(operation => {
            const operationName = operation.charAt(0).toUpperCase() + operation.slice(1);
            const displayName = `${entity.name} ${operationName}`;
            const value = `${entity.name}.${operation}`;

            operations.push({
                name: displayName,
                value,
                description: `${operationName} operation on ${entity.name} resource`,
            });
        });
    });

    // Sort alphabetically for better UX
    return operations.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Static list of all available tool operations for AI enumeration
 */
export const TOOL_OPERATION_OPTIONS: INodePropertyOptions[] = generateToolOperations();

/**
 * Get operations for a specific resource (for backwards compatibility)
 */
export function getToolOperationsForResource(resource: string): INodePropertyOptions[] {
    return TOOL_OPERATION_OPTIONS.filter(option =>
        String(option.value).startsWith(`${resource}.`)
    );
}

/**
 * Parse tool operation value back to resource and operation
 */
export function parseToolOperation(toolOperation: string): { resource: string; operation: string } | null {
    const parts = toolOperation.split('.');
    if (parts.length !== 2) {
        return null;
    }

    const [resource, operation] = parts;
    return { resource, operation };
}

/**
 * Validate that a tool operation is supported
 */
export function isValidToolOperation(toolOperation: string): boolean {
    return TOOL_OPERATION_OPTIONS.some(option => option.value === toolOperation);
}

/**
 * Get all resources that support operations
 */
export function getSupportedResources(): string[] {
    const resources = new Set<string>();

    TOOL_OPERATION_OPTIONS.forEach(option => {
        const { resource } = parseToolOperation(String(option.value))!;
        resources.add(resource);
    });

    return Array.from(resources).sort();
}

/**
 * Get operation statistics for debugging
 */
export function getToolSurfaceStats(): { totalOperations: number; totalResources: number; operationsPerResource: Record<string, number> } {
    const operationsPerResource: Record<string, number> = {};
    const resources = new Set<string>();

    TOOL_OPERATION_OPTIONS.forEach(option => {
        const { resource } = parseToolOperation(String(option.value))!;
        resources.add(resource);
        operationsPerResource[resource] = (operationsPerResource[resource] || 0) + 1;
    });

    return {
        totalOperations: TOOL_OPERATION_OPTIONS.length,
        totalResources: resources.size,
        operationsPerResource,
    };
}
