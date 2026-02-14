export interface StructuredToolError {
    error: true;
    errorType: string;
    message: string;
    operation: string;
    nextAction: string;
    context?: Record<string, unknown>;
}

function buildOperation(resource: string, operation: string): string {
    return `${resource}.${operation}`;
}

export function formatFieldError(
    errorType: 'INVALID_FIELDS' | 'INVALID_WRITE_FIELDS',
    resource: string,
    operation: string,
    invalidFields: string[],
    validFieldsSample: string[],
): StructuredToolError {
    const mode = errorType === 'INVALID_FIELDS' ? 'read' : 'write';
    return {
        error: true,
        errorType,
        message: `Invalid field name(s) for ${buildOperation(resource, operation)}: ${invalidFields.join(', ')}`,
        operation: buildOperation(resource, operation),
        nextAction: `Call autotask_${resource}_describeFields with mode '${mode}', then retry with valid field names.`,
        context: {
            invalidFields,
            validFieldsSample,
        },
    };
}

export function formatRequiredFieldsError(
    resource: string,
    operation: string,
    missingFields: string[],
): StructuredToolError {
    return {
        error: true,
        errorType: 'MISSING_REQUIRED_FIELDS',
        message: `Missing required field(s) for ${buildOperation(resource, operation)}: ${missingFields.join(', ')}`,
        operation: buildOperation(resource, operation),
        nextAction: `Call autotask_${resource}_describeFields with mode 'write' to review required fields, then retry.`,
        context: {
            missingFields,
        },
    };
}

export function formatIdError(resource: string, operation: string): StructuredToolError {
    return {
        error: true,
        errorType: 'MISSING_ENTITY_ID',
        message: `A numeric entity ID is required for ${buildOperation(resource, operation)}.`,
        operation: buildOperation(resource, operation),
        nextAction: `Provide a numeric ID. If unknown, call autotask_${resource}_getMany to locate the correct record first.`,
    };
}

export function formatFilterConstraintError(
    resource: string,
    operation: string,
    message: string,
    nextAction: string,
): StructuredToolError {
    return {
        error: true,
        errorType: 'INVALID_FILTER_CONSTRAINT',
        message,
        operation: buildOperation(resource, operation),
        nextAction,
    };
}

export function formatApiError(
    message: string,
    resource: string,
    operation: string,
): StructuredToolError {
    const lowerMessage = message.toLowerCase();

    if (
        lowerMessage.includes('lock')
        || lowerMessage.includes('concurrent')
        || lowerMessage.includes('deadlock')
    ) {
        return {
            error: true,
            errorType: 'CONCURRENCY_CONFLICT',
            message,
            operation: buildOperation(resource, operation),
            nextAction: 'Retry with a short backoff and serialise requests for this resource to reduce table lock contention.',
        };
    }

    if (
        lowerMessage.includes('forbidden')
        || lowerMessage.includes('unauthor')
        || lowerMessage.includes('permission')
        || lowerMessage.includes('access denied')
    ) {
        return {
            error: true,
            errorType: 'PERMISSION_DENIED',
            message,
            operation: buildOperation(resource, operation),
            nextAction: 'Verify API user security level and line-of-business permissions. Data can exist but still be inaccessible.',
        };
    }

    if (lowerMessage.includes('picklist') || lowerMessage.includes('invalid value')) {
        return {
            error: true,
            errorType: 'INVALID_PICKLIST_VALUE',
            message,
            operation: buildOperation(resource, operation),
            nextAction: `Call autotask_${resource}_listPicklistValues with the relevant fieldId, then retry with a valid picklist value.`,
        };
    }

    if (lowerMessage.includes('required') || lowerMessage.includes('missing')) {
        return {
            error: true,
            errorType: 'MISSING_REQUIRED_FIELDS',
            message,
            operation: buildOperation(resource, operation),
            nextAction: `Call autotask_${resource}_describeFields with mode 'write', then retry with all required fields.`,
        };
    }

    if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
        return {
            error: true,
            errorType: 'ENTITY_NOT_FOUND',
            message,
            operation: buildOperation(resource, operation),
            nextAction: `Use autotask_${resource}_getMany with a filter to locate a valid record ID, then retry.`,
        };
    }

    return {
        error: true,
        errorType: 'API_ERROR',
        message,
        operation: buildOperation(resource, operation),
        nextAction: `Verify parameter names and values. If unsure, call autotask_${resource}_describeFields first and retry.`,
    };
}
