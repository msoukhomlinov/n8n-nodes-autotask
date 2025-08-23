import type { ILoadOptionsFunctions, IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IAutotaskField } from '../types/base/entities';
import { getResourceOperations } from '../constants/resource-operations';
import { OperationType } from '../types/base/entity-types';
import { FieldProcessor } from '../operations/base/field-processor';
import { getFields } from './entity/api';
import { handleErrors } from './errorHandler';
import { getConfiguredTimezone } from './date-time/utils';

/**
 * Map field names to their referenced entities
 */
const REFERENCE_FIELD_MAPPINGS: Record<string, string> = {
    // Standard entity references
    'companyID': 'company',
    'accountID': 'company',
    'contactID': 'contact',
    'resourceID': 'resource',
    'assignedResourceID': 'resource',
    'projectID': 'project',
    'ticketID': 'ticket',
    'contractID': 'contract',
    'opportunityID': 'salesOrder',
    'quoteID': 'quote',
    'invoiceID': 'invoice',
    'taskID': 'task',
    'changeRequestID': 'changeRequest',
    'problemID': 'problem',
    'serviceCallID': 'serviceCall',
    'timeEntryID': 'timeEntry',
    'expenseItemID': 'expenseItem',
    'productID': 'product',
    'serviceID': 'service',
    'billingCodeID': 'billingCode',
    'departmentID': 'department',
    'roleID': 'role',
    'queueID': 'ticketCategory',
    'subIssueTypeID': 'ticketSubIssueType',
    'sourceID': 'ticketSource',
    'priorityID': 'priority',
    'statusID': 'status',
    'typeID': 'type',
    'categoryID': 'category',
    'subcategoryID': 'subcategory',
    // Add more as discovered
};

/**
 * Determine what entity a field references based on field name and context
 */
function getReferencedEntity(fieldId: string, resource: string): string | undefined {
    // Direct mapping lookup
    if (REFERENCE_FIELD_MAPPINGS[fieldId]) {
        return REFERENCE_FIELD_MAPPINGS[fieldId];
    }

    // Pattern-based detection for ID fields
    if (fieldId.endsWith('ID')) {
        // Normalise: strip ID, lower-case, remove underscores/spaces
        const rawName = fieldId.replace(/ID$/, '');
        const normalised = rawName.toLowerCase().replace(/[_\s]/g, '');

        // Tolerate common AI/user variants and typos
        const aliasCorrections: Record<string, string> = {
            // typos
            'resrouce': 'resource',
            // camel/underscores collapsed
            'accountmanager': 'resource',
            'assignedresource': 'resource',
        };

        const corrected = aliasCorrections[normalised] ?? normalised;

        // Common entity name mappings
        const entityMappings: Record<string, string> = {
            'account': 'company',
            'assignee': 'resource',
            'creator': 'resource',
            'modifier': 'resource',
            'owner': 'resource',
            'salesperson': 'resource',
            'resource': 'resource',
            'parent': resource, // References same entity type for hierarchical relations
        };

        return entityMappings[corrected] || corrected;
    }

    return undefined;
}

/**
 * Get field dependencies based on business logic
 */
function getFieldDependencies(fieldId: string, resource: string): string[] {
    const dependencies: Record<string, Record<string, string[]>> = {
        // Contact dependencies
        contact: {
            companyID: [], // Company must exist
            contactID: ['companyID'], // Contact requires company context in some cases
        },
        // Ticket dependencies
        ticket: {
            contactID: ['companyID'], // Contact must belong to company
            assignedResourceID: [], // Resource must exist
            projectID: ['companyID'], // Project belongs to company
            contractID: ['companyID'], // Contract belongs to company
        },
        // Project dependencies
        project: {
            companyID: [], // Company must exist
            contractID: ['companyID'], // Contract must belong to same company
            projectManagerResourceID: [], // Resource must exist
        },
        // Add more resource-specific dependencies
    };

    return dependencies[resource]?.[fieldId] || [];
}

/**
 * Field metadata for AI introspection
 */
export interface FieldMeta {
    id: string;
    name: string;
    type: 'string' | 'number' | 'boolean' | 'datetime' | 'array' | 'object' | 'email' | 'url' | 'phone' | string;
    required: boolean;
    udf: boolean;
    isPickList: boolean;
    isReference: boolean;
    allowedValues?: Array<{ id: string | number; label: string }>;
    referencesEntity?: string;  // What entity this field references (e.g., 'company', 'contact')
    dependencies?: string[];    // Other fields this field depends on
}

export interface AiFunction {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string; enum?: string[]; const?: string }>;
        required: string[];
    };
}

/**
 * Response for describeResource operation
 */
export interface DescribeResourceResponse {
    resource: string;
    mode: 'read' | 'write';
    timezone: string;
    fields: FieldMeta[];
    notes?: string[];
    functions?: AiFunction[];
}

/**
 * Response for listPicklistValues operation
 */
export interface ListPicklistValuesResponse {
    fieldId: string;
    page: number;
    limit: number;
    total?: number;
    values: Array<{ id: string | number; label: string }>;
}

/**
 * Response for validateParameters operation
 */
export interface ValidateParametersResponse {
    resource: string;
    mode: 'create' | 'update';
    isValid: boolean;
    errors: Array<{ field: string; message: string; code: string }>;
    warnings: Array<{ field: string; message: string; code: string }>;
    fieldValidation: IDataObject;
    summary: IDataObject;
}

/**
 * Describes resource fields and metadata for AI introspection
 */
export async function describeResource(
    context: ILoadOptionsFunctions | IExecuteFunctions,
    resource: string,
    mode: 'read' | 'write'
): Promise<DescribeResourceResponse> {
    return await handleErrors(context as IExecuteFunctions, async () => {
        console.debug(`[aiHelper.describeResource] Describing ${resource} in ${mode} mode`);

        // Get timezone for this context
        const timezone = await getConfiguredTimezone.call(context);

        // Get both standard and UDF fields using the existing field API
        const [standardFields, udfFields] = await Promise.all([
            getFields(resource, context, { fieldType: 'standard' }) as Promise<IAutotaskField[]>,
            getFields(resource, context, { fieldType: 'udf', isActive: true }) as Promise<IAutotaskField[]>
        ]);

        console.debug(`[aiHelper.describeResource] Retrieved ${standardFields.length} standard, ${udfFields.length} UDF fields`);

        // Process fields through the existing pipeline to get proper typing and filtering
        const operation = mode === 'write' ? OperationType.CREATE : OperationType.QUERY;
        const processor = FieldProcessor.getInstance(resource, operation, context as IExecuteFunctions);

        // Process fields to get properly filtered and typed metadata
        const [{ fields: processedStandardFields }, { fields: processedUdfFields }] = await Promise.all([
            processor.processFields(standardFields, operation, { mode, fieldType: 'standard' }),
            processor.processFields(udfFields, operation, { mode, fieldType: 'udf' })
        ]);

        // Convert processed fields to FieldMeta format
        const allProcessedFields = [...processedStandardFields, ...processedUdfFields];
        const fields: FieldMeta[] = allProcessedFields.map(field => {
            // Check if field has picklist values and if they're too large to include
            const hasLargePicklist = field.options && Array.isArray(field.options) && field.options.length > 50;

            const fieldMeta: FieldMeta = {
                id: field.id,
                name: field.id, // Use id as name for consistency
                type: field.type || 'string',
                required: field.required || false,
                udf: field.id.startsWith('UDF') || Boolean((field as unknown as { isUdf?: boolean }).isUdf),
                isPickList: Boolean(field.options && Array.isArray(field.options) && field.options.length > 0),
                isReference: Boolean((field as unknown as { isReference?: boolean }).isReference)
            };

            // Add entity reference information for reference fields
            if (fieldMeta.isReference) {
                const referencedEntity = getReferencedEntity(field.id, resource);
                if (referencedEntity) {
                    fieldMeta.referencesEntity = referencedEntity;
                }
            }

            // Add field dependencies
            const dependencies = getFieldDependencies(field.id, resource);
            if (dependencies.length > 0) {
                fieldMeta.dependencies = dependencies;
            }

            // Include allowed values for small picklists, exclude for large ones
            if (fieldMeta.isPickList && field.options && !hasLargePicklist) {
                fieldMeta.allowedValues = (field.options as Array<{ value: string | number; name?: string; label?: string }>).map(option => ({
                    id: option.value,
                    label: option.name || option.label || String(option.value)
                }));
            }

            return fieldMeta;
        });

        // Generate helpful notes
        const notes: string[] = [];
        const largePicklistFields = fields.filter(f => f.isPickList && !f.allowedValues);

        if (largePicklistFields.length > 0) {
            notes.push(`Fields with large picklists (use listPicklistValues): ${largePicklistFields.map(f => f.id).join(', ')}`);
        }

        const requiredFields = fields.filter(f => f.required);
        if (requiredFields.length > 0) {
            notes.push(`Required fields for ${mode}: ${requiredFields.map(f => f.id).join(', ')}`);
        }

        // Add entity reference information
        const referenceFields = fields.filter(f => f.isReference && f.referencesEntity);
        if (referenceFields.length > 0) {
            const referenceInfo = referenceFields.map(f => `${f.id} → ${f.referencesEntity}`).join(', ');
            notes.push(`Reference fields (must reference existing entities): ${referenceInfo}`);
        }

        // Add dependency information
        const fieldsWithDependencies = fields.filter(f => f.dependencies && f.dependencies.length > 0);
        if (fieldsWithDependencies.length > 0) {
            const dependencyInfo = fieldsWithDependencies.map(f =>
                `${f.id} requires: ${f.dependencies!.join(', ')}`
            ).join('; ');
            notes.push(`Field dependencies: ${dependencyInfo}`);
        }

        // Add workflow guidance for write operations
        if (mode === 'write') {
            const hasCompanyRef = fields.some(f => f.id === 'companyID' && f.required);
            const hasContactRef = fields.some(f => f.id === 'contactID');

            if (hasCompanyRef && hasContactRef) {
                notes.push(`Workflow tip: Ensure company exists before creating ${resource}. If using contactID, verify contact belongs to the specified company.`);
            } else if (hasCompanyRef) {
                notes.push(`Workflow tip: Ensure referenced company exists before creating ${resource}.`);
            }
        }

        const operations = getResourceOperations(resource);
        const functions: AiFunction[] = operations.map(operation => {
            const parameters: AiFunction['parameters'] = {
                type: 'object',
                properties: {
                    targetResource: {
                        type: 'string',
                        description: 'Target resource name or ID',
                        const: resource,
                    },
                    resourceOperation: {
                        type: 'string',
                        description: 'Operation name or ID to execute',
                        const: operation,
                    },
                },
                required: ['targetResource', 'resourceOperation'],
            };

            if (['get', 'update', 'delete'].includes(operation)) {
                parameters.properties.entityId = {
                    type: 'string',
                    description: `ID of the ${resource}`,
                };
                parameters.required.push('entityId');
            }

            if (['create', 'update'].includes(operation)) {
                parameters.properties.fields = {
                    type: 'object',
                    description: 'JSON object with field values for the record',
                };
                parameters.required.push('fields');
            }

            if (['getMany', 'count'].includes(operation)) {
                parameters.properties.filters = {
                    type: 'object',
                    description: 'Optional filters for the query',
                };
            }

            return {
                name: `${resource}_${operation}`,
                description: `${operation} ${resource} using Autotask tool`,
                parameters,
            };
        });

        const result: DescribeResourceResponse = {
            resource,
            mode,
            timezone,
            fields,
            notes: notes.length > 0 ? notes : undefined,
            functions: functions.length > 0 ? functions : undefined,
        };

        console.debug(`[aiHelper.describeResource] Returning ${fields.length} fields for ${resource} (${mode})`);
        return result;
    });
}

/**
 * Lists picklist values for a specific field with pagination and search
 */
export async function listPicklistValues(
    context: ILoadOptionsFunctions | IExecuteFunctions,
    resource: string,
    fieldId: string,
    query?: string,
    limit: number = 50,
    page: number = 1
): Promise<ListPicklistValuesResponse> {
    return await handleErrors(context as IExecuteFunctions, async () => {
        console.debug(`[aiHelper.listPicklistValues] Listing values for ${resource}.${fieldId}, query: ${query}, limit: ${limit}, page: ${page}`);

        // Get the field processor to access existing picklist infrastructure
        const processor = FieldProcessor.getInstance(resource, OperationType.QUERY, context as IExecuteFunctions);

        // Get all fields to find the specific field
        const standardFields = await getFields(resource, context, { fieldType: 'standard' }) as IAutotaskField[];
        const udfFields = await getFields(resource, context, { fieldType: 'udf', isActive: true }) as IAutotaskField[];
        const allFields = [...standardFields, ...udfFields];

        // Find the target field
        const targetField = allFields.find(field =>
            field.name === fieldId || field.name.toLowerCase() === fieldId.toLowerCase()
        );

        if (!targetField) {
            throw new Error(`Field '${fieldId}' not found in resource '${resource}'`);
        }

        // Process the field to get picklist values
        const { fields: processedFields } = await processor.processFields([targetField], OperationType.QUERY, {
            mode: 'read',
            fieldType: targetField.name.startsWith('UDF') ? 'udf' : 'standard'
        });

        const processedField = processedFields[0];
        if (!processedField || !processedField.options) {
            return {
                fieldId,
                page,
                limit,
                values: []
            };
        }

        // Extract values from the processed field options
        let allValues = (processedField.options as Array<{ value: string | number; name?: string; label?: string }>).map(option => ({
            id: option.value,
            label: option.name || option.label || String(option.value)
        }));

        // Apply search filter if provided
        if (query && query.trim()) {
            const searchTerm = query.toLowerCase();
            allValues = allValues.filter(value =>
                value.label.toLowerCase().includes(searchTerm) ||
                String(value.id).toLowerCase().includes(searchTerm)
            );
        }

        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedValues = allValues.slice(startIndex, endIndex);

        const result: ListPicklistValuesResponse = {
            fieldId,
            page,
            limit,
            total: allValues.length,
            values: paginatedValues
        };

        console.debug(`[aiHelper.listPicklistValues] Returning ${paginatedValues.length} of ${allValues.length} values for ${fieldId}`);
        return result;
    });
}

/**
 * Response for validateParameters operation
 */
export interface ValidateParametersResponse {
    resource: string;
    mode: 'create' | 'update';
    isValid: boolean;
    errors: Array<{
        field: string;
        message: string;
        code: string;
    }>;
    warnings: Array<{
        field: string;
        message: string;
        code: string;
    }>;
    fieldValidation: IDataObject;
    summary: IDataObject;
}

/**
 * Validates parameters for create/update operations without making API calls
 */
export async function validateParameters(
    context: ILoadOptionsFunctions | IExecuteFunctions,
    resource: string,
    mode: 'create' | 'update',
    fieldValues: Record<string, unknown>
): Promise<ValidateParametersResponse> {
    return await handleErrors(context as IExecuteFunctions, async () => {
        console.debug(`[aiHelper.validateParameters] Validating ${resource} parameters for ${mode} mode`);

        // Get field metadata first
        const resourceDescription = await describeResource(context, resource, 'write');
        const fields = resourceDescription.fields;

        const errors: Array<{ field: string; message: string; code: string }> = [];
        const warnings: Array<{ field: string; message: string; code: string }> = [];
        const fieldValidation: IDataObject = {};

        // Initialize validation status for all fields
        for (const field of fields) {
            const fieldErrors: string[] = [];
            const fieldWarnings: string[] = [];
            const provided = field.id in fieldValues;
            let valid = true;

            fieldValidation[field.id] = {
                provided,
                valid,
                type: field.type,
                required: field.required
            } as unknown as IDataObject;

            // Check required fields
            if (field.required && !provided) {
                const message = `Required field '${field.id}' is missing`;
                errors.push({ field: field.id, message, code: 'REQUIRED_FIELD_MISSING' });
                fieldErrors.push(message);
                valid = false;
            }

            // If field is provided, validate its value
            if (provided) {
                const value = fieldValues[field.id];

                // Check for null/undefined values on required fields
                if (field.required && (value === null || value === undefined || value === '')) {
                    const message = `Required field '${field.id}' has empty value`;
                    errors.push({ field: field.id, message, code: 'REQUIRED_FIELD_EMPTY' });
                    fieldErrors.push(message);
                    valid = false;
                }

                // Type validation
                if (value !== null && value !== undefined) {
                    const isValidType = validateFieldType(value, field.type);
                    if (!isValidType) {
                        const message = `Field '${field.id}' expects type '${field.type}' but got '${typeof value}'`;
                        errors.push({ field: field.id, message, code: 'INVALID_TYPE' });
                        fieldErrors.push(message);
                        valid = false;
                    }
                }

                // Picklist validation
                if (field.isPickList && field.allowedValues && value !== null && value !== undefined) {
                    const allowedIds = field.allowedValues.map(v => v.id);
                    if (!allowedIds.includes(value as string | number)) {
                        const message = `Field '${field.id}' has invalid picklist value. Use aiHelper.listPicklistValues to get valid options.`;
                        errors.push({ field: field.id, message, code: 'INVALID_PICKLIST_VALUE' });
                        fieldErrors.push(message);
                        valid = false;
                    }
                }

                // Reference validation (basic check)
                if (field.isReference && field.referencesEntity && value !== null && value !== undefined) {
                    // Basic type check for reference fields (should be number or string)
                    if (typeof value !== 'string' && typeof value !== 'number') {
                        const message = `Reference field '${field.id}' should be a number or string ID`;
                        errors.push({ field: field.id, message, code: 'INVALID_REFERENCE_TYPE' });
                        fieldErrors.push(message);
                        valid = false;
                    } else {
                        // Add warning about existence check
                        const message = `Reference field '${field.id}' points to ${field.referencesEntity}. Ensure the referenced record exists.`;
                        warnings.push({ field: field.id, message, code: 'REFERENCE_EXISTENCE_CHECK' });
                        fieldWarnings.push(message);
                    }
                }

                // Dependency validation
                if (field.dependencies && field.dependencies.length > 0) {
                    for (const depField of field.dependencies) {
                        if (!(depField in fieldValues) || fieldValues[depField] === null || fieldValues[depField] === undefined) {
                            const message = `Field '${field.id}' requires '${depField}' to be provided`;
                            errors.push({ field: field.id, message, code: 'DEPENDENCY_MISSING' });
                            fieldErrors.push(message);
                            valid = false;
                        }
                    }
                }
            }

            // Update field validation with collected errors/warnings
            (fieldValidation[field.id] as unknown as { valid: boolean }).valid = valid;
            if (fieldErrors.length > 0) {
                (fieldValidation[field.id] as unknown as { errors?: string[] }).errors = fieldErrors;
            }
            if (fieldWarnings.length > 0) {
                (fieldValidation[field.id] as unknown as { warnings?: string[] }).warnings = fieldWarnings;
            }
        }

        // Check for unknown fields
        const knownFieldIds = fields.map(f => f.id);
        for (const providedField of Object.keys(fieldValues)) {
            if (!knownFieldIds.includes(providedField)) {
                const message = `Unknown field '${providedField}' provided. Use aiHelper.describeResource to see available fields.`;
                warnings.push({ field: providedField, message, code: 'UNKNOWN_FIELD' });

                // Add to field validation
                fieldValidation[providedField] = {
                    provided: true,
                    valid: false,
                    type: 'unknown',
                    required: false,
                    warnings: [message]
                } as unknown as IDataObject;
            }
        }

        // Calculate summary
        const totalFields = fields.length;
        const providedFields = Object.keys(fieldValues).length;
        const validFields = Object.values(fieldValidation).filter((f: unknown) => (f as { valid?: boolean })?.valid === true).length;
        const requiredFieldsMissing = errors.filter(e => e.code === 'REQUIRED_FIELD_MISSING').length;
        const invalidValues = errors.filter(e => e.code !== 'REQUIRED_FIELD_MISSING').length;

        const isValid = errors.length === 0;

        const result: ValidateParametersResponse = {
            resource,
            mode,
            isValid,
            errors,
            warnings,
            fieldValidation,
            summary: {
                totalFields,
                providedFields,
                validFields,
                requiredFieldsMissing,
                invalidValues
            }
        };

        console.debug(`[aiHelper.validateParameters] Validation complete for ${resource}: isValid=${isValid}, errors=${errors.length}, warnings=${warnings.length}`);
        return result;
    });
}

/**
 * Validate field value type
 */
function validateFieldType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
        case 'string':
        case 'email':
        case 'url':
        case 'phone':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && !isNaN(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'datetime':
            // Accept strings that look like dates or Date objects
            return typeof value === 'string' || value instanceof Date;
        case 'array':
            return Array.isArray(value);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
            // For unknown types, accept any non-null value
            return value !== null && value !== undefined;
    }
}
