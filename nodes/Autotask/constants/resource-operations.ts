export const RESOURCE_OPERATIONS_MAP: Record<string, string[]> = {
    // Core entities with full CRUD
    timeEntry: ['create', 'get', 'getMany', 'update', 'delete', 'count'],
    ticket: ['create', 'get', 'getMany', 'update', 'count'],
    company: ['create', 'get', 'getMany', 'update', 'count'],
    contact: ['create', 'get', 'getMany', 'update', 'count'],
    project: ['create', 'get', 'getMany', 'update', 'count'],
    contract: ['create', 'get', 'getMany', 'update', 'count'],
    // Notes and related entities
    ticketNote: ['create', 'get', 'getMany', 'update', 'count'],
    companyNote: ['create', 'get', 'getMany', 'update', 'count'],
    projectNote: ['create', 'get', 'getMany', 'update', 'count'],
    contractNote: ['create', 'get', 'getMany', 'update', 'count'],
    configurationItemNote: ['create', 'get', 'getMany', 'update', 'count'],
    // Configuration items
    configurationItems: ['create', 'get', 'getMany', 'update', 'count'],
    configurationItemCategories: ['create', 'get', 'getMany', 'update', 'count'],
    configurationItemTypes: ['create', 'get', 'getMany', 'update', 'count'],
    // Webhooks (typically no create/update)
    ticketWebhook: ['get', 'getMany', 'delete'],
    ticketNoteWebhook: ['get', 'getMany', 'delete'],
    companyWebhook: ['get', 'getMany', 'delete'],
    configurationItemWebhook: ['get', 'getMany', 'delete'],
    contactWebhook: ['get', 'getMany', 'delete'],
    // Resources and roles
    resource: ['get', 'getMany', 'update', 'count'],
    resourceRole: ['get', 'getMany', 'count'],
    role: ['get', 'getMany', 'update', 'count'],
    // Products and services
    product: ['create', 'get', 'getMany', 'update', 'count'],
    productVendor: ['create', 'get', 'getMany', 'update', 'count'],
    service: ['create', 'get', 'getMany', 'update', 'count'],
    // Contract-related entities
    contractService: ['create', 'get', 'getMany', 'update', 'count'],
    contractCharge: ['create', 'get', 'getMany', 'update', 'count'],
    contractRate: ['create', 'get', 'getMany', 'update', 'count'],
    contractBlock: ['create', 'get', 'getMany', 'update', 'count'],
    contractMilestone: ['create', 'get', 'getMany', 'update', 'count'],
    // Billing and financial
    billingCode: ['get', 'getMany', 'count'],
    invoice: ['update', 'get', 'getMany', 'count', 'pdf', 'markupHtml', 'markupXml'],
    // Quotes
    quote: ['create', 'get', 'getMany', 'update', 'count'],
    quoteItem: ['create', 'get', 'getMany', 'update', 'delete', 'count'],
    // Company-related
    companyAlert: ['create', 'get', 'getMany', 'update', 'count'],
    companyLocation: ['create', 'get', 'getMany', 'update', 'count'],
    companySiteConfigurations: ['create', 'get', 'getMany', 'update', 'count'],
    // Contact groups
    contactGroups: ['create', 'get', 'getMany', 'update', 'count'],
    contactGroupContacts: ['create', 'get', 'getMany', 'delete', 'count'],
    // Service calls
    serviceCall: ['create', 'get', 'getMany', 'update', 'count'],
    serviceCallTicket: ['create', 'get', 'getMany', 'update', 'count'],
    serviceCallTask: ['create', 'get', 'getMany', 'update', 'count'],
    // Survey and feedback
    survey: ['get', 'getMany', 'count'],
    surveyResults: ['get', 'getMany', 'count'],
    // Opportunities
    opportunity: ['create', 'get', 'getMany', 'update', 'count'],
    // Skills and specialties
    skill: ['get', 'getMany', 'count'],
    // Calendar and scheduling
    holidaySet: ['get', 'getMany', 'count'],
    holiday: ['get', 'getMany', 'count'],
    // Project tasks and phases
    task: ['create', 'get', 'getMany', 'update', 'count'],
    phase: ['create', 'get', 'getMany', 'update', 'count'],
    projectCharge: ['create', 'get', 'getMany', 'update', 'count'],
    // Notification and history
    notificationHistory: ['get', 'getMany', 'count'],
    TicketHistory: ['get', 'getMany', 'count'],
    // Countries and regions
    country: ['get', 'getMany', 'count'],
    // Domain registrar
    DomainRegistrar: ['get', 'getMany', 'count'],
    // AI Helper for introspection
    aiHelper: ['describeResource', 'listPicklistValues', 'validateParameters'],
    // API threshold monitoring
    apiThreshold: ['get'],
};

const NORMALIZED_RESOURCE_OPERATIONS_MAP = Object.fromEntries(
    Object.entries(RESOURCE_OPERATIONS_MAP).map(([key, value]) => [key.toLowerCase(), value]),
);

export function getResourceOperations(resource: string): string[] {
    return NORMALIZED_RESOURCE_OPERATIONS_MAP[resource.toLowerCase()] || [];
}
