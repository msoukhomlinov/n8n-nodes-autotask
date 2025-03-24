import pluralize from 'pluralize';

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

  switch (urlType) {
    case WebhookUrlType.WEBHOOK_BASE:
      if (!entityType) throw new Error('Entity type is required for webhook URLs');
      return `/${getSingularEntityName(entityType)}Webhooks`;

    case WebhookUrlType.WEBHOOK_SPECIFIC:
      if (!entityType) throw new Error('Entity type is required for webhook URLs');
      if (!id) throw new Error('ID is required for specific webhook URLs');
      return `/${getSingularEntityName(entityType)}Webhooks/${id}`;

    case WebhookUrlType.WEBHOOK_FIELDS:
      if (!entityType) throw new Error('Entity type is required for webhook field URLs');
      if (!parentId) throw new Error('Parent webhook ID is required for webhook field URLs');
      return `/${getSingularEntityName(entityType)}Webhooks/${parentId}/Fields`;

    case WebhookUrlType.WEBHOOK_UDF_FIELDS:
      if (!entityType) throw new Error('Entity type is required for webhook UDF field URLs');
      if (!parentId) throw new Error('Parent webhook ID is required for webhook UDF field URLs');
      return `/${getSingularEntityName(entityType)}Webhooks/${parentId}/UdfFields`;

    case WebhookUrlType.WEBHOOK_RESOURCES:
      if (!entityType) throw new Error('Entity type is required for webhook resource URLs');
      if (!parentId) throw new Error('Parent webhook ID is required for webhook resource URLs');
      return `/${getSingularEntityName(entityType)}Webhooks/${parentId}/ExcludedResources`;

    case WebhookUrlType.WEBHOOK_FIELD_INFO:
      if (!entityType) throw new Error('Entity type is required for webhook field info URLs');
      return `/${getSingularEntityName(entityType)}WebhookFields/entityInformation/fields`;

    case WebhookUrlType.WEBHOOK_UDF_FIELD_INFO:
      if (!entityType) throw new Error('Entity type is required for webhook UDF field info URLs');
      return `/${getSingularEntityName(entityType)}WebhookUdfFields/entityInformation/fields`;

    case WebhookUrlType.ENTITY_FIELDS:
      if (!entityType) throw new Error('Entity type is required for entity field URLs');
      return `/${pluralize(entityType)}/entityInformation/fields`;

    case WebhookUrlType.ENTITY_UDF_FIELDS:
      if (!entityType) throw new Error('Entity type is required for entity UDF field URLs');
      return `/${pluralize(entityType)}/entityInformation/userDefinedFields`;

    case WebhookUrlType.GENERAL_QUERY:
      if (!endpoint) throw new Error('Endpoint is required for general query URLs');
      return endpoint;

    default:
      throw new Error(`Unknown URL type: ${urlType}`);
  }
}
