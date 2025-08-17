// No external imports required

export interface JsonValidationResult {
    isValid: boolean;
    parsedValue?: unknown;
    error?: Error;
}

/**
 * Validate a JSON-type node parameter that may be provided as a string or object.
 * Returns a structured result to support agent-friendly error handling.
 */
// Note: unified validator is provided at the bottom of this file.

import { withAgentHint } from './agent-error-hints';

/**
 * Validation result for JSON parameters
 */
// (duplicate interface removed)

/**
 * Validate bodyJson parameter format and content
 */
export function validateBodyJson(value: unknown, resource: string): JsonValidationResult {
    // Handle empty/null values
    if (value === undefined || value === null || value === '') {
        return { isValid: true, parsedValue: {} };
    }

    // Parse string values
    let parsed: unknown;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch (error) {
            const validationError = new Error(`Invalid JSON in bodyJson: ${(error as Error).message}`);
            return {
                isValid: false,
                error: withAgentHint(validationError, {
                    resource,
                    operation: 'create',
                    fieldName: 'bodyJson'
                })
            };
        }
    } else {
        parsed = value;
    }

    // Validate that parsed value is an object
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        const validationError = new Error('bodyJson must be a JSON object with field IDs as keys');
        return {
            isValid: false,
            error: withAgentHint(validationError, {
                resource,
                operation: 'create',
                fieldName: 'bodyJson'
            })
        };
    }

    // Validate object structure - all keys should be strings (field IDs)
    const obj = parsed as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        if (typeof key !== 'string' || key.trim() === '') {
            const validationError = new Error(`Invalid field ID '${key}' in bodyJson. Field IDs must be non-empty strings.`);
            return {
                isValid: false,
                error: withAgentHint(validationError, {
                    resource,
                    operation: 'create',
                    fieldName: 'bodyJson',
                    fieldValue: key
                })
            };
        }
    }

    return { isValid: true, parsedValue: obj };
}

/**
 * Validate selectColumnsJson parameter format and content
 */
export function validateSelectColumnsJson(value: unknown, resource: string): JsonValidationResult {
    // Handle empty/null values
    if (value === undefined || value === null || value === '') {
        return { isValid: true, parsedValue: [] };
    }

    // Parse string values
    let parsed: unknown;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch (error) {
            const validationError = new Error(`Invalid JSON in selectColumnsJson: ${(error as Error).message}`);
            return {
                isValid: false,
                error: withAgentHint(validationError, {
                    resource,
                    operation: 'get',
                    fieldName: 'selectColumnsJson'
                })
            };
        }
    } else {
        parsed = value;
    }

    // Validate that parsed value is an array
    if (!Array.isArray(parsed)) {
        const validationError = new Error('selectColumnsJson must be a JSON array of field ID strings');
        return {
            isValid: false,
            error: withAgentHint(validationError, {
                resource,
                operation: 'get',
                fieldName: 'selectColumnsJson'
            })
        };
    }

    // Validate array contents - all elements should be non-empty strings
    const arr = parsed as unknown[];
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (typeof item !== 'string' || item.trim() === '') {
            const validationError = new Error(`Invalid field ID '${item}' at index ${i} in selectColumnsJson. All elements must be non-empty field ID strings.`);
            return {
                isValid: false,
                error: withAgentHint(validationError, {
                    resource,
                    operation: 'get',
                    fieldName: 'selectColumnsJson',
                    fieldValue: item
                })
            };
        }
    }

    // Remove duplicates and trim whitespace
    const cleanedArray = [...new Set(arr.map(item => (item as string).trim()))];

    return { isValid: true, parsedValue: cleanedArray };
}

/**
 * Validate and parse JSON parameter with helpful error context
 */
export function validateJsonParameter(
    value: unknown,
    parameterName: 'bodyJson' | 'selectColumnsJson',
    resource: string
): JsonValidationResult {
    switch (parameterName) {
        case 'bodyJson':
            return validateBodyJson(value, resource);
        case 'selectColumnsJson':
            return validateSelectColumnsJson(value, resource);
        default:
            throw new Error(`Unknown JSON parameter: ${parameterName}`);
    }
}
