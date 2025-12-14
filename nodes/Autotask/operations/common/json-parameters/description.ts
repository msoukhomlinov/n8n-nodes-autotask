import type { INodeProperties } from 'n8n-workflow';

/**
 * JSON parameter for write operations - allows overriding/augmenting mapped fields
 */
export const bodyJsonOption: INodeProperties = {
    displayName: 'Body (JSON)',
    name: 'bodyJson',
    type: 'json',
    default: '{}',
    description: 'Optional JSON body to override or augment mapped fields. Keys should be field ID. Use aiHelper.describeResource to see available fields.',
    hint: 'JSON object where keys are field IDs and values are the field values. This will override any values set through the resource mapper.',
    displayOptions: {
        show: {
            operation: ['create', 'update', 'upsert'],
        },
    },
    placeholder: '{\n  "title": "Example Ticket",\n  "description": "Created via JSON parameter",\n  "priority": "Medium"\n}',
};

/**
 * JSON parameter for read operations - alternative to Select Columns UI
 */
export const selectColumnsJsonOption: INodeProperties = {
    displayName: 'Select Columns (JSON)',
    name: 'selectColumnsJson',
    type: 'json',
    default: '[]',
    description: 'Array of field ID to select. Alternative to the Select Columns UI picker. Use aiHelper.describeResource to see available fields.',
    hint: 'Array of field ID strings. If provided, this overrides the Select Columns UI selection. Leave empty to use UI selection or return all fields.',
    displayOptions: {
        show: {
            operation: ['get', 'getMany', 'getManyAdvanced'],
        },
    },
    placeholder: '["ID", "title", "description", "status", "priority", "companyID"]',
};

/**
 * Output mode option for controlling response format
 */
export const outputModeOption: INodeProperties = {
    displayName: 'Output Mode',
    name: 'outputMode',
    type: 'options',
    options: [
        {
            name: 'IDs and Labels',
            value: 'idsAndLabels',
            description: 'Include both IDs and human-readable labels (default behaviour)',
        },
        {
            name: 'Raw IDs Only',
            value: 'rawIds',
            description: 'Return only raw ID values for minimal token usage',
        },
        {
            name: 'Labels Only',
            value: 'labelsOnly',
            description: 'Return only human-readable labels where available',
        },
    ],
    default: 'idsAndLabels',
    description: 'Choose how to format picklist and reference field values in the response',
};

/**
 * Dry run option for write operations (create, update, delete)
 */
export const dryRunOption: INodeProperties = {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    description: 'Whether to return a request preview instead of executing the operation. Useful for testing and validation.',
    hint: 'When enabled, no API call is made. Instead, returns the request details that would be sent. No changes are made to Autotask.',
    displayOptions: {
        show: {
            operation: ['create', 'update', 'delete'],
        },
    },
};

/**
 * Helper function to add JSON body parameter to write operations
 */
export function addBodyJsonOption(
    properties: INodeProperties[],
    resourceName: string,
): INodeProperties[] {
    const resourceOption: INodeProperties = {
        ...bodyJsonOption,
        displayOptions: {
            show: {
                ...bodyJsonOption.displayOptions?.show,
                resource: [resourceName],
            },
        },
    };

    return [...properties, resourceOption];
}

/**
 * Helper function to add JSON select columns parameter to read operations
 */
export function addSelectColumnsJsonOption(
    properties: INodeProperties[],
    resourceName: string,
): INodeProperties[] {
    const resourceOption: INodeProperties = {
        ...selectColumnsJsonOption,
        displayOptions: {
            show: {
                ...selectColumnsJsonOption.displayOptions?.show,
                resource: [resourceName],
            },
        },
    };

    return [...properties, resourceOption];
}

/**
 * Helper function to add output mode option
 */
export function addOutputModeOption(
    properties: INodeProperties[],
    resourceName: string,
): INodeProperties[] {
    const resourceOption: INodeProperties = {
        ...outputModeOption,
        displayOptions: {
            show: {
                resource: [resourceName],
            },
        },
    };

    return [...properties, resourceOption];
}

/**
 * Helper function to add dry run option
 */
export function addDryRunOption(
    properties: INodeProperties[],
    resourceName: string,
): INodeProperties[] {
    const resourceOption: INodeProperties = {
        ...dryRunOption,
        displayOptions: {
            show: {
                ...dryRunOption.displayOptions?.show,  // Preserve operation restriction
                resource: [resourceName],
            },
        },
    };

    return [...properties, resourceOption];
}

/**
 * Add all agent-friendly options to a resource
 */
export function addAgentFriendlyOptions(
    properties: INodeProperties[],
    resourceName: string,
    options: {
        includeBodyJson?: boolean;
        includeSelectColumnsJson?: boolean;
        includeDryRun?: boolean;
    } = {}
): INodeProperties[] {
    let result = properties;

    const {
        includeBodyJson = true,
        includeSelectColumnsJson = true,
        includeDryRun = true,
    } = options;

    if (includeBodyJson) {
        result = addBodyJsonOption(result, resourceName);
    }

    if (includeSelectColumnsJson) {
        result = addSelectColumnsJsonOption(result, resourceName);
    }

    if (includeDryRun) {
        result = addDryRunOption(result, resourceName);
    }

    return result;
}
