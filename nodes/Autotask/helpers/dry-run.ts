import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { getConfiguredTimezone } from './date-time/utils';
import { getSelectedColumns } from '../operations/common/select-columns';

/**
 * Dry-run response structure
 */
export interface DryRunResponse {
    dryRun: true;
    resource: string;
    operation: string;
    timezone: string;
    request: {
        method: string;
        url: string;
        query?: IDataObject;
        headers?: IDataObject;
        body?: IDataObject;
    };
    selectColumns?: string[];
    notes?: string[];
    resolutions?: Array<{ field: string; from: string | number; to: string | number; method: string }>;
}

/**
 * Check if dry-run mode is enabled
 */
export function isDryRunEnabled(context: IExecuteFunctions, itemIndex: number = 0): boolean {
    try {
        return context.getNodeParameter('dryRun', itemIndex, false) as boolean;
    } catch {
        return false;
    }
}

/**
 * Create a dry-run response for any operation
 */
export async function createDryRunResponse(
    context: IExecuteFunctions,
    resource: string,
    operation: string,
    requestDetails: {
        method: string;
        url: string;
        query?: IDataObject;
        headers?: IDataObject;
        body?: IDataObject;
    },
    itemIndex: number = 0
): Promise<DryRunResponse> {
    const timezone = await getConfiguredTimezone.call(context);
    const notes: string[] = [];

    const response: DryRunResponse = {
        dryRun: true,
        resource,
        operation,
        timezone,
        request: {
            method: requestDetails.method,
            url: requestDetails.url,
        }
    };

    // Add query parameters if present
    if (requestDetails.query && Object.keys(requestDetails.query).length > 0) {
        response.request.query = requestDetails.query;
    }

    // Add headers if present
    if (requestDetails.headers && Object.keys(requestDetails.headers).length > 0) {
        response.request.headers = requestDetails.headers;
    }

    // Add body if present
    if (requestDetails.body && Object.keys(requestDetails.body).length > 0) {
        response.request.body = requestDetails.body;
    }

    // Add select columns for read operations
    if (['get', 'getMany', 'getManyAdvanced'].includes(operation)) {
        const selectedColumns = getSelectedColumns(context, itemIndex);
        if (selectedColumns.length > 0) {
            response.selectColumns = selectedColumns;
            notes.push(`Selected columns: ${selectedColumns.length} fields`);
        } else {
            notes.push('No columns selected - all fields will be returned');
        }
    }

    // Add operation-specific notes
    switch (operation) {
        case 'create':
            notes.push('This would create a new entity');
            break;
        case 'update':
            notes.push('This would update an existing entity');
            break;
        case 'delete':
            notes.push('This would delete an entity');
            break;
        case 'get':
            notes.push('This would retrieve a single entity by ID');
            break;
        case 'getMany':
            notes.push('This would retrieve multiple entities');
            break;
        case 'getManyAdvanced':
            notes.push('This would retrieve entities using advanced filters');
            break;
    }

    // Check for JSON parameter usage
    try {
        const bodyJson = context.getNodeParameter('bodyJson', itemIndex, {}) as IDataObject;
        if (Object.keys(bodyJson).length > 0) {
            notes.push(`Using bodyJson with ${Object.keys(bodyJson).length} field override(s)`);
        }
    } catch {
        // Parameter doesn't exist
    }

    try {
        const selectColumnsJson = context.getNodeParameter('selectColumnsJson', itemIndex, []) as string[];
        if (selectColumnsJson.length > 0) {
            notes.push(`Using selectColumnsJson with ${selectColumnsJson.length} field(s)`);
        }
    } catch {
        // Parameter doesn't exist
    }

    // Check for output mode
    try {
        const outputMode = context.getNodeParameter('outputMode', itemIndex, 'idsAndLabels') as string;
        if (outputMode !== 'idsAndLabels') {
            notes.push(`Output mode: ${outputMode}`);
        }
    } catch {
        // Parameter doesn't exist
    }

    if (notes.length > 0) {
        response.notes = notes;
    }

    console.debug('[createDryRunResponse] Generated dry-run response for', operation, resource);
    return response;
}
