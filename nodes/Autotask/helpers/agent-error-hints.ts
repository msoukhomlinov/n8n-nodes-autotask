// Agent error hint utilities

/**
 * Enhanced error with agent-friendly hints
 */
export interface AgentError extends Error {
    extensions?: {
        hint?: string;
        suggestions?: string[];
        helpfulOperations?: string[];
    };
}

/**
 * Error categories for hint generation
 */
export enum ErrorCategory {
    MISSING_REQUIRED_FIELD = 'missing_required_field',
    INVALID_PICKLIST_VALUE = 'invalid_picklist_value',
    INVALID_REFERENCE_VALUE = 'invalid_reference_value',
    FIELD_NOT_FOUND = 'field_not_found',
    OVER_FETCHING = 'over_fetching',
    RATE_LIMIT = 'rate_limit',
    AUTHENTICATION = 'authentication',
    FIELD_READ_ONLY = 'field_read_only',
    PARENT_ID_MISSING = 'parent_id_missing',
    VALIDATION_ERROR = 'validation_error',
}

/**
 * Generate agent-friendly hint for an error
 */
export function generateAgentHint(
    error: Error,
    context: {
        resource?: string;
        operation?: string;
        fieldName?: string;
        fieldValue?: unknown;
        entityType?: string;
    } = {}
): string {
    const { resource = 'unknown', operation = 'unknown', fieldName, fieldValue } = context;

    // Detect error category based on error message
    const errorMessage = error.message.toLowerCase();
    const category = detectErrorCategory(errorMessage);

    switch (category) {
        case ErrorCategory.MISSING_REQUIRED_FIELD:
            return `Call aiHelper.describeResource('${resource}', 'write') to see required fields for ${operation} operations. Then ensure all required fields are provided in your bodyJson or resource mapper.`;

        case ErrorCategory.INVALID_PICKLIST_VALUE:
            if (fieldName) {
                return `Field '${fieldName}' has invalid value '${fieldValue}'. Use aiHelper.listPicklistValues('${resource}', '${fieldName}') to get valid options, then retry with a valid value.`;
            }
            return `Invalid picklist value detected. Use aiHelper.describeResource('${resource}', 'write') to identify picklist fields, then aiHelper.listPicklistValues() to get valid values.`;

        case ErrorCategory.INVALID_REFERENCE_VALUE:
            if (fieldName) {
                return `Reference field '${fieldName}' has invalid ID '${fieldValue}'. Use aiHelper.listPicklistValues('${resource}', '${fieldName}', 'search_term') to find valid reference ID, then retry.`;
            }
            return `Invalid reference ID detected. Use aiHelper.describeResource('${resource}', 'write') to identify reference fields and get valid ID values.`;

        case ErrorCategory.FIELD_NOT_FOUND:
            return `Field '${fieldName}' not found in ${resource}. Call aiHelper.describeResource('${resource}', '${operation === 'get' ? 'read' : 'write'}') to see available fields and their exact names.`;

        case ErrorCategory.OVER_FETCHING:
            return `Too many results returned. Reduce maxRecords parameter or add more specific filters. Consider using selectColumnsJson to limit returned fields and reduce payload size.`;

        case ErrorCategory.RATE_LIMIT:
            return `API rate limit exceeded. Wait before retrying, reduce request frequency, or use smaller batch sizes. Consider using outputMode: 'rawIds' to reduce response size.`;

        case ErrorCategory.AUTHENTICATION:
            return `Authentication failed. Verify your Autotask API credentials are correct and have necessary permissions for ${operation} operations on ${resource}.`;

        case ErrorCategory.FIELD_READ_ONLY:
            if (fieldName) {
                return `Field '${fieldName}' is read-only and cannot be modified in ${operation} operations. Remove it from your bodyJson or resource mapper.`;
            }
            return `Read-only field detected in ${operation} operation. Use aiHelper.describeResource('${resource}', 'write') to see which fields can be modified.`;

        case ErrorCategory.PARENT_ID_MISSING:
            return `Parent entity ID required for ${resource} ${operation}. This is a child entity - ensure you provide the parent entity ID in your request.`;

        case ErrorCategory.VALIDATION_ERROR:
            return `Field validation failed. Use aiHelper.describeResource('${resource}', 'write') to see field requirements, data types, and constraints. Ensure all field values match expected formats.`;

        default:
            return `Use aiHelper.describeResource('${resource}', '${operation === 'get' ? 'read' : 'write'}') to understand field requirements and constraints for ${operation} operations.`;
    }
}

/**
 * Detect error category from error message and context
 */
function detectErrorCategory(
    errorMessage: string
): ErrorCategory {
    // Check for required field errors
    if (errorMessage.includes('required') || errorMessage.includes('mandatory')) {
        return ErrorCategory.MISSING_REQUIRED_FIELD;
    }

    // Check for picklist value errors
    if (errorMessage.includes('invalid') && (errorMessage.includes('picklist') || errorMessage.includes('option'))) {
        return ErrorCategory.INVALID_PICKLIST_VALUE;
    }

    // Check for reference value errors
    if (errorMessage.includes('invalid') && (errorMessage.includes('reference') || errorMessage.includes('id'))) {
        return ErrorCategory.INVALID_REFERENCE_VALUE;
    }

    // Check for field not found errors
    if (errorMessage.includes('field') && (errorMessage.includes('not found') || errorMessage.includes('unknown'))) {
        return ErrorCategory.FIELD_NOT_FOUND;
    }

    // Check for read-only field errors
    if (errorMessage.includes('read-only') || errorMessage.includes('readonly') ||
        (errorMessage.includes('cannot') && errorMessage.includes('modify'))) {
        return ErrorCategory.FIELD_READ_ONLY;
    }

    // Check for over-fetching errors
    if (errorMessage.includes('too many') || errorMessage.includes('limit exceeded') ||
        errorMessage.includes('maximum')) {
        return ErrorCategory.OVER_FETCHING;
    }

    // Check for rate limit errors
    if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
        return ErrorCategory.RATE_LIMIT;
    }

    // Check for authentication errors
    if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ||
        errorMessage.includes('forbidden') || errorMessage.includes('access denied')) {
        return ErrorCategory.AUTHENTICATION;
    }

    // Check for parent ID errors (child entities)
    if (errorMessage.includes('parent') && errorMessage.includes('id')) {
        return ErrorCategory.PARENT_ID_MISSING;
    }

    // Default to validation error
    return ErrorCategory.VALIDATION_ERROR;
}

/**
 * Enhance an error with agent-friendly hints
 */
export function withAgentHint(
    error: Error,
    context: {
        resource?: string;
        operation?: string;
        fieldName?: string;
        fieldValue?: unknown;
        entityType?: string;
    } = {}
): AgentError {
    const agentError = error as AgentError;

    if (!agentError.extensions) {
        agentError.extensions = {};
    }

    // Generate the main hint
    agentError.extensions.hint = generateAgentHint(error, context);

    // Add helpful operations
    agentError.extensions.helpfulOperations = [
        'aiHelper.describeResource',
        'aiHelper.listPicklistValues'
    ];

    // Add specific suggestions based on error category
    const category = detectErrorCategory(error.message.toLowerCase());
    agentError.extensions.suggestions = generateSuggestions(category, context);

    return agentError;
}

/**
 * Generate specific suggestions based on error category
 */
function generateSuggestions(
    category: ErrorCategory,
    context: { resource?: string; operation?: string; fieldName?: string }
): string[] {
    const { resource = 'resource', fieldName } = context;

    switch (category) {
        case ErrorCategory.MISSING_REQUIRED_FIELD:
            return [
                `Check required fields: aiHelper.describeResource('${resource}', 'write')`,
                'Ensure all required fields are included in bodyJson',
                'Verify field names are spelled correctly'
            ];

        case ErrorCategory.INVALID_PICKLIST_VALUE:
            return [
                fieldName
                    ? `Get valid values: aiHelper.listPicklistValues('${resource}', '${fieldName}')`
                    : `Get valid values: aiHelper.listPicklistValues('${resource}', 'fieldName')`,
                'Use exact values from the picklist response',
                'Check for case sensitivity and spacing'
            ];

        case ErrorCategory.INVALID_REFERENCE_VALUE:
            return [
                fieldName
                    ? `Find valid ID: aiHelper.listPicklistValues('${resource}', '${fieldName}', 'search')`
                    : 'Search for valid reference IDs using listPicklistValues',
                'Ensure the referenced entity exists',
                'Use numeric IDs for reference fields'
            ];

        case ErrorCategory.OVER_FETCHING:
            return [
                'Add filters to reduce result set size',
                'Use selectColumnsJson to limit returned fields',
                'Set maxRecords to a lower value',
                'Consider outputMode: "rawIds" for smaller payloads'
            ];

        case ErrorCategory.RATE_LIMIT:
            return [
                'Wait before retrying the request',
                'Reduce request frequency',
                'Use smaller batch sizes',
                'Implement exponential backoff'
            ];

        default:
            return [
                'Check field requirements and constraints',
                'Verify data types and formats',
                'Ensure all required fields are provided'
            ];
    }
}

/**
 * Extract field information from error message for better hints
 */
export function extractFieldInfoFromError(error: Error): { fieldName?: string; fieldValue?: unknown } {
    const message = error.message;

    // Try to extract field name from common error patterns
    const fieldNamePatterns = [
        /field\s+'([^']+)'/i,
        /field\s+"([^"]+)"/i,
        /'([^']+)'\s+field/i,
        /"([^"]+)"\s+field/i,
        /property\s+'([^']+)'/i,
        /\[([^\]]+)\]/
    ];

    for (const pattern of fieldNamePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            return { fieldName: match[1] };
        }
    }

    return {};
}
