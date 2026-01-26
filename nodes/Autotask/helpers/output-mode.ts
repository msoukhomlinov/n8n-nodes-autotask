import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskEntity } from '../types/base/entity-types';
import { OperationType } from '../types/base/entity-types';

/**
 * Output mode options
 */
export type OutputMode = 'rawIds' | 'idsAndLabels' | 'labelsOnly';

/**
 * Options for output mode processing
 */
export interface OutputModeOptions {
    addPicklistLabels?: boolean;
    addReferenceLabels?: boolean;
    outputMode?: OutputMode;
}

/**
 * Get output mode configuration from node parameters
 */
export function getOutputModeConfig(context: IExecuteFunctions, itemIndex: number): OutputModeOptions {
    let outputMode: OutputMode = 'idsAndLabels'; // Default
    let addPicklistLabels = false;
    let addReferenceLabels = false;

    // Get output mode parameter
    try {
        outputMode = context.getNodeParameter('outputMode', itemIndex, 'idsAndLabels') as OutputMode;
    } catch {
        // Parameter doesn't exist, use default
    }

    // Determine enrichment settings based on output mode
    switch (outputMode) {
        case 'rawIds':
            // No enrichment - return raw ID values only
            addPicklistLabels = false;
            addReferenceLabels = false;
            break;

        case 'idsAndLabels':
            // Full enrichment - include both IDs and labels (default behaviour)
            try {
                addPicklistLabels = context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;
            } catch {
                addPicklistLabels = false;
            }
            try {
                addReferenceLabels = context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;
            } catch {
                addReferenceLabels = false;
            }
            break;

        case 'labelsOnly':
            // Label-only mode - enrich first, then replace IDs with labels
            addPicklistLabels = true;
            addReferenceLabels = true;
            break;
    }

    console.debug(`[getOutputModeConfig] Output mode: ${outputMode}, picklist: ${addPicklistLabels}, reference: ${addReferenceLabels}`);

    return {
        outputMode,
        addPicklistLabels,
        addReferenceLabels,
    };
}

/**
 * Process entities according to output mode configuration
 */
export async function processOutputMode<T extends IAutotaskEntity>(
    entities: T | T[],
    entityType: string,
    context: IExecuteFunctions,
    itemIndex: number = 0
): Promise<T | T[]> {
    const config = getOutputModeConfig(context, itemIndex);

    // Handle single entity case
    const entitiesArray = Array.isArray(entities) ? entities : [entities];
    const wasSingle = !Array.isArray(entities);

    if (entitiesArray.length === 0) {
        return entities;
    }

    let processedEntities = [...entitiesArray];

    // Skip processing if rawIds mode and no labels are enabled
    if (config.outputMode === 'rawIds' && !config.addPicklistLabels && !config.addReferenceLabels) {
        console.debug('[processOutputMode] Raw IDs mode with no label enrichment, returning entities as-is');
        return entities;
    }

    // LAZY IMPORT: Import FieldProcessor only when needed to break circular dependency
    const { FieldProcessor } = await import('../operations/base/field-processor');

    // Get field processor for enrichment
    const fieldProcessor = FieldProcessor.getInstance(
        entityType,
        OperationType.READ,
        context
    );

    // Apply enrichment based on configuration
    if (config.addReferenceLabels) {
        console.debug('[processOutputMode] Enriching with reference labels');
        processedEntities = await fieldProcessor.enrichWithReferenceLabels(processedEntities) as T[];
    }

    if (config.addPicklistLabels) {
        console.debug('[processOutputMode] Enriching with picklist labels');
        processedEntities = await fieldProcessor.enrichWithPicklistLabels(processedEntities) as T[];
    }

    // Apply labels-only transformation if needed
    if (config.outputMode === 'labelsOnly') {
        console.debug('[processOutputMode] Converting to labels-only mode');
        processedEntities = processedEntities.map(entity => convertToLabelsOnly(entity));
    }

    // Return in the same format as input (single entity or array)
    return wasSingle ? processedEntities[0] : processedEntities;
}

/**
 * Convert entity to labels-only format by replacing ID fields with their corresponding label values
 */
function convertToLabelsOnly<T extends IAutotaskEntity>(entity: T): T {
    const result = { ...entity } as IDataObject;

    // Process all fields in the entity
    for (const [key, value] of Object.entries(entity)) {
        // Check if there's a corresponding label field
        const labelField = `${key}_label`;

        if (labelField in entity) {
            // Replace the ID field with the label value
            const labelValue = (entity as IDataObject)[labelField];
            if (labelValue !== null && labelValue !== undefined) {
                result[key] = labelValue;
                console.debug(`[convertToLabelsOnly] Replaced ${key}=${value} with label: ${labelValue}`);
            }

            // Remove the label field since we've merged it into the main field
            delete result[labelField];
        }
    }

    return result as T;
}
