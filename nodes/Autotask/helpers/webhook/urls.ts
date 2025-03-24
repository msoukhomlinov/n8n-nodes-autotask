import pluralize from 'pluralize';
import { AutotaskErrorType } from '../errorHandler';
import { AutotaskWebhookEntityType } from '../../types/webhook';

/**
 * Logs an error and throws it with standardized formatting
 * @param operation The name of the operation being performed
 * @param errorType The type of error that occurred
 * @param message Human-readable error message
 * @param context Optional additional context information
 * @throws Error with formatted message
 */
function logAndThrowError(operation: string, errorType: AutotaskErrorType, message: string, context?: Record<string, unknown>): never {
  const contextInfo = context ? `, Context: ${JSON.stringify(context)}` : '';
  const errorMessage = `[${errorType}] Operation: ${operation}${contextInfo}, ${message}`;
  console.error(errorMessage);
  throw new Error(errorMessage);
}

/**
 * URL endpoint types for webhook operations
 */
export enum WebhookUrlType {
  WEBHOOK_BASE = 'webhookBase',         // /{SingularEntityName}Webhooks
  WEBHOOK_SPECIFIC = 'webhookSpecific', // /{SingularEntityName}Webhooks/{id}
  WEBHOOK_FIELDS = 'webhookFields',     // /{SingularEntityName}Webhooks/{parentId}/Fields
  WEBHOOK_UDF_FIELDS = 'webhookUdfFields', // /{SingularEntityName}Webhooks/{parentId}/UdfFields
  WEBHOOK_RESOURCES = 'webhookResources', // /{SingularEntityName}Webhooks/{parentId}/ExcludedResources
  WEBHOOK_FIELD_INFO = 'webhookFieldInfo', // /{SingularEntityName}WebhookFields/entityInformation/fields
  WEBHOOK_UDF_FIELD_INFO = 'webhookUdfFieldInfo', // /{SingularEntityName}WebhookUdfFields/entityInformation/fields
  ENTITY_FIELDS = 'entityFields',       // /{entityPlural}/entityInformation/fields
  ENTITY_UDF_FIELDS = 'entityUdfFields', // /{entityPlural}/entityInformation/userDefinedFields
  GENERAL_QUERY = 'generalQuery',       // Direct endpoint query (e.g., Resources/query)
}

/**
 * Validates if an entity type is supported for webhooks
 * @param entityType The entity type to validate
 * @param strict If true, throw error for invalid types; if false, return boolean
 * @param operation Optional operation name for error context
 * @returns True if valid (when strict=false), otherwise throws
 */
export function validateEntityType(
  entityType: string | undefined,
  strict = true,
  operation = 'validateEntityType'
): boolean {
  // Allow undefined/empty when not in strict mode
  if (!entityType) {
    if (strict) {
      logAndThrowError(
        operation,
        AutotaskErrorType.Validation,
        'Entity type is required',
        { entityType }
      );
    }
    return false;
  }

  const supportedTypes = Object.values(AutotaskWebhookEntityType);
  const isValid = supportedTypes.includes(entityType as AutotaskWebhookEntityType);

  if (!isValid && strict) {
    logAndThrowError(
      operation,
      AutotaskErrorType.Validation,
      `Unsupported entity type: ${entityType}. Supported types are: ${supportedTypes.join(', ')}`,
      { entityType }
    );
  }

  return isValid;
}

/**
 * Gets the singular form of an entity name for webhook URLs
 * Autotask requires entity names in webhook-related URLs to be singular
 * Examples:
 * - Companies → Company
 * - Tickets → Ticket
 * - TicketNotes → TicketNote
 * - ConfigurationItems → ConfigurationItem
 * - Contacts → Contact
 */
function getSingularEntityName(entityType: string): string {
  // Handle special cases that may not be correctly singularized by the pluralize library
  const specialCaseMappings: Record<string, string> = {
    'TicketNotes': 'TicketNote',
    'ConfigurationItems': 'ConfigurationItem',
    'Companies': 'Company',
    'Contacts': 'Contact',
    'Tickets': 'Ticket',
    // Add other special cases here if needed
  };

  if (specialCaseMappings[entityType]) {
    return specialCaseMappings[entityType];
  }

  return pluralize.singular(entityType);
}

/**
 * Builds webhook-related URLs for Autotask API
 */
export function buildWebhookUrl(
  urlType: WebhookUrlType,
  options: {
    entityType?: string;
    id?: string | number;
    endpoint?: string; // For direct endpoints like 'Resources/query'
    parentId?: string | number; // For child resources
  },
): string {
  const { entityType, id, endpoint, parentId } = options;
  const operation = 'buildWebhookUrl';

  switch (urlType) {
    case WebhookUrlType.WEBHOOK_BASE:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      return `/${getSingularEntityName(entityType!)}Webhooks`;

    case WebhookUrlType.WEBHOOK_SPECIFIC:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      if (!id) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'ID is required for specific webhook URLs',
          { urlType, entityType }
        );
      }
      return `/${getSingularEntityName(entityType!)}Webhooks/${id}`;

    case WebhookUrlType.WEBHOOK_FIELDS:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook field URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      if (!parentId) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Parent webhook ID is required for webhook field URLs',
          { urlType, entityType }
        );
      }
      return `/${getSingularEntityName(entityType!)}Webhooks/${parentId}/Fields`;

    case WebhookUrlType.WEBHOOK_UDF_FIELDS:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook UDF field URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      if (!parentId) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Parent webhook ID is required for webhook UDF field URLs',
          { urlType, entityType }
        );
      }
      return `/${getSingularEntityName(entityType!)}Webhooks/${parentId}/UdfFields`;

    case WebhookUrlType.WEBHOOK_RESOURCES:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook resource URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      if (!parentId) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Parent webhook ID is required for webhook resource URLs',
          { urlType, entityType }
        );
      }
      return `/${getSingularEntityName(entityType!)}Webhooks/${parentId}/ExcludedResources`;

    case WebhookUrlType.WEBHOOK_FIELD_INFO:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook field info URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      return `/${getSingularEntityName(entityType!)}WebhookFields/entityInformation/fields`;

    case WebhookUrlType.WEBHOOK_UDF_FIELD_INFO:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for webhook UDF field info URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      return `/${getSingularEntityName(entityType!)}WebhookUdfFields/entityInformation/fields`;

    case WebhookUrlType.ENTITY_FIELDS:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for entity field URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      return `/${pluralize(entityType!)}entityInformation/fields`;

    case WebhookUrlType.ENTITY_UDF_FIELDS:
      if (!entityType) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Entity type is required for entity UDF field URLs',
          { urlType }
        );
      }
      validateEntityType(entityType, true, operation);
      return `/${pluralize(entityType!)}entityInformation/userDefinedFields`;

    case WebhookUrlType.GENERAL_QUERY:
      if (!endpoint) {
        logAndThrowError(
          operation,
          AutotaskErrorType.Validation,
          'Endpoint is required for general query URLs',
          { urlType }
        );
      }
      return endpoint;

    default:
      logAndThrowError(
        operation,
        AutotaskErrorType.Unknown,
        `Unknown URL type: ${urlType}`,
        { urlType, options }
      );
  }
}
