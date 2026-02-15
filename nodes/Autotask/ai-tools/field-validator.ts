import type { FieldMeta } from '../helpers/aiHelper';
import type { StructuredToolError } from './error-formatter';
import { formatFieldError, formatIdError, formatRequiredFieldsError } from './error-formatter';

interface ValidationSuccess {
    valid: true;
}

interface ValidationFailure {
    valid: false;
    error: StructuredToolError;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function sampleValidFields(fields: FieldMeta[], limit = 20): string[] {
    return fields.slice(0, limit).map((field) => field.id);
}

function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function getFieldValueCaseInsensitive(
    fieldValues: Record<string, unknown>,
    fieldId: string,
): unknown {
    const matchKey = Object.keys(fieldValues).find(
        (key) => key.toLowerCase() === fieldId.toLowerCase(),
    );
    return matchKey ? fieldValues[matchKey] : undefined;
}

export function validateReadFields(
    selectedColumns: string[],
    readFields: FieldMeta[],
    resource: string,
    operation: string,
): ValidationResult {
    if (!selectedColumns.length || !readFields.length) {
        return { valid: true };
    }

    const readFieldSet = new Set(readFields.map((field) => field.id.toLowerCase()));
    const invalidFields = selectedColumns.filter(
        (field) => !readFieldSet.has(field.toLowerCase()),
    );

    if (!invalidFields.length) {
        return { valid: true };
    }

    return {
        valid: false,
        error: formatFieldError(
            'INVALID_FIELDS',
            resource,
            operation,
            invalidFields,
            sampleValidFields(readFields),
        ),
    };
}

export function validateWriteFields(
    fieldValues: Record<string, unknown>,
    writeFields: FieldMeta[],
    resource: string,
    operation: string,
): ValidationResult {
    if (!writeFields.length) {
        return { valid: true };
    }

    const writeFieldSet = new Set(writeFields.map((field) => field.id.toLowerCase()));
    const providedFields = Object.keys(fieldValues);

    const invalidFields = providedFields.filter(
        (field) => !writeFieldSet.has(field.toLowerCase()),
    );

    if (invalidFields.length > 0) {
        return {
            valid: false,
            error: formatFieldError(
                'INVALID_WRITE_FIELDS',
                resource,
                operation,
                invalidFields,
                sampleValidFields(writeFields),
            ),
        };
    }

    if (operation === 'create') {
        const missingRequiredFields = writeFields
            .filter((field) => field.required)
            .map((field) => field.id)
            .filter((fieldId) => isEmptyValue(getFieldValueCaseInsensitive(fieldValues, fieldId)));

        if (missingRequiredFields.length > 0) {
            return {
                valid: false,
                error: formatRequiredFieldsError(resource, operation, missingRequiredFields),
            };
        }
    }

    return { valid: true };
}

export function validateEntityId(
    idValue: string | number | undefined,
    resource: string,
    operation: string,
): ValidationResult {
    const noIdOperations = [
        'getMany',
        'searchByDomain',
        'getPosted',
        'getUnposted',
        'count',
        'create',
        'moveToCompany',
        'moveConfigurationItem',
        'transferOwnership',
        'whoAmI',
        'slaHealthCheck',
    ];
    if (noIdOperations.includes(operation)) {
        return { valid: true };
    }

    if (idValue === undefined || idValue === '') {
        return {
            valid: false,
            error: formatIdError(resource, operation),
        };
    }

    const idString = String(idValue).trim();
    if (!/^\d+$/.test(idString)) {
        return {
            valid: false,
            error: formatIdError(resource, operation),
        };
    }

    return { valid: true };
}
