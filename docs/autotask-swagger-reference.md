# Autotask REST API — Swagger Reference

## File

**Path:** `autotask-swagger.json` (project root)
**Spec version:** Swagger 2.0
**API title:** Datto|Autotask PSA Rest API v1
**Base URL:** `https://webservices6.autotask.net/ATServicesRest/V1.0/`

The file is 168 000+ lines and is the authoritative, machine-readable description of every
endpoint the Autotask REST API exposes. Use it to:

- Look up exact field names, types, and required flags for any entity
- Discover endpoints not yet implemented in this node
- Verify HTTP method availability (GET / POST / PATCH / DELETE) for a given entity
- Understand parent/child URL patterns (e.g. `Companies/{parentId}/Notes/{id}`)
- Find request/response model schemas under `definitions`

---

## Statistics

| Category | Count |
|---|---|
| Total API paths | 2 072 |
| Total entity tags | 382 |
| Model definitions | 787 |
| Full CRUD entities (GET+POST+PATCH+DELETE) | 57 |
| Read + Create + Update entities (no DELETE) | 74 |
| Read + Create only entities | 160 |
| Read-only entities | 25 |
| Other / child-only entities | 66 |

---

## Authentication

Every path requires three headers (already handled by the `autotaskApi` credential):

| Header | Description |
|---|---|
| `ApiIntegrationCode` | API integration key |
| `UserName` | API user email |
| `Secret` | API user password |
| `ImpersonationResourceId` | Optional — resource to impersonate |

---

## Entity Catalogue

### Full CRUD (GET + POST + PATCH + DELETE) — 57 entities

```
ActionTypes, Appointments, ArticleNotesChild, ChangeOrderCharges,
ChecklistLibraries, ChecklistLibraryChecklistItemsChild, ComanagedAssociations,
CompanyAlertsChild, CompanyContactsChild, CompanyLocationsChild, CompanyToDosChild,
CompanyWebhookFieldsChild, CompanyWebhookUdfFieldsChild, CompanyWebhooks,
ConfigurationItemBillingProductAssociationsChild,
ConfigurationItemCategoryUdfAssociationsChild, ConfigurationItemTypes,
ConfigurationItemWebhookFieldsChild, ConfigurationItemWebhookUdfFieldsChild,
ConfigurationItemWebhooks, ContactBillingProductAssociationsChild, ContactGroups,
ContactWebhookFieldsChild, ContactWebhookUdfFieldsChild, ContactWebhooks,
ContractBillingRulesChild, ContractChargesChild, ContractExclusionSets,
DocumentCategories, DocumentChecklistItemsChild, DocumentNotesChild,
DocumentsChild, HolidaySets, HolidaysChild, IntegrationVendorInsights,
IntegrationVendorWidgets, InventoryProducts, KnowledgeBaseArticlesChild,
KnowledgeBaseCategories, ProductTiersChild, ProjectChargesChild, QuoteItemsChild,
ServiceBundles, ServiceCalls, Subscriptions, TagGroups, Tags,
TaskPredecessorsChild, TicketChargesChild, TicketChecklistItemsChild,
TicketNoteWebhookFieldsChild, TicketNoteWebhooks, TicketRmaCreditsChild,
TicketWebhookFieldsChild, TicketWebhookUdfFieldsChild, TicketWebhooks,
TimeEntries
```

### Read + Create + Update (no DELETE) — 74 entities

```
BillingItems, ClientPortalUsers, Companies, CompanyCategories, CompanyNotesChild,
ConfigurationItemCategories, ConfigurationItemNotesChild, ConfigurationItems,
ContractBlockHourFactorsChild, ContractBlocksChild, ContractMilestonesChild,
ContractNotesChild, ContractRatesChild, ContractRetainersChild,
ContractRoleCostsChild, ContractServiceBundlesChild, ContractServicesChild,
ContractTicketPurchasesChild, Contracts, Countries, Currencies, Departments,
DomainRegistrars, ExpenseItemsChild, ExpenseReports,
InternalLocationWithBusinessHours, InventoryItemSerialNumbersChild,
InventoryItems, InventoryLocations, Invoices, Opportunities, OpportunityCategories,
OrganizationalLevel1, OrganizationalLevel2, OrganizationalLevelAssociation,
PaymentTerms, PhasesChild, PriceListMaterialCodes, PriceListProductTiers,
PriceListProducts, PriceListRoles, PriceListServiceBundles, PriceListServices,
PriceListWorkTypeModifiers, ProductNotesChild, ProductVendorsChild, Products,
ProjectNotesChild, Projects, PurchaseApprovals, PurchaseOrderItemsChild,
PurchaseOrders, QuoteLocations, Quotes, ResourceRoleDepartmentsChild,
ResourceRoleQueuesChild, ResourceServiceDeskRolesChild, Resources, Roles,
SalesOrders, Services, TaskNotes, TaskNotesChild, TasksChild, TaxCategories,
TaxRegions, Taxes, TicketCategories, TicketNotesChild, Tickets,
TimeOffRequestsChild, UserDefinedFieldDefinitions, UserDefinedFieldListItemsChild,
WorkTypeModifiers
```

### Read + Create (no UPDATE or DELETE) — 160 entities

```
AdditionalInvoiceFieldValues, ArticleAttachments,
ArticleConfigurationItemCategoryAssociations, ArticleNotes,
ArticlePlainTextContent, ArticleTagAssociations, ArticleTicketAssociations,
ArticleToArticleAssociations, ArticleToDocumentAssociations, AttachmentInfo,
BillingCodes, BillingItemApprovalLevels, ChecklistLibraryChecklistItems,
ClassificationIcons, CompanyAlerts, CompanyAttachments, CompanyLocations,
CompanyNoteAttachments, CompanyNotes, CompanySiteConfigurations, CompanyTeams,
CompanyToDos, CompanyWebhookExcludedResources, CompanyWebhookFields,
CompanyWebhookUdfFields, ConfigurationItemAttachments,
ConfigurationItemBillingProductAssociations,
ConfigurationItemCategoryUdfAssociations, ConfigurationItemDnsRecords,
ConfigurationItemNoteAttachments, ConfigurationItemNotes,
ConfigurationItemRelatedItems, ConfigurationItemSslSubjectAlternativeNames,
ConfigurationItemWebhookExcludedResources, ConfigurationItemWebhookFields,
ConfigurationItemWebhookUdfFields, ContactBillingProductAssociations,
ContactGroupContacts, ContactWebhookExcludedResources, ContactWebhookFields,
ContactWebhookUdfFields, Contacts, ContractBillingRules, ContractBlockHourFactors,
ContractBlocks, ContractCharges, ContractExclusionBillingCodes,
ContractExclusionRoles, ContractExclusionSetExcludedRoles,
ContractExclusionSetExcludedWorkTypes, ContractMilestones,
ContractNoteAttachments, ContractNotes, ContractRates, ContractRetainers,
ContractRoleCosts, ContractServiceAdjustments, ContractServiceAdjustmentsChild,
ContractServiceBundleAdjustments, ContractServiceBundleAdjustmentsChild,
ContractServiceBundleUnits, ContractServiceBundles, ContractServiceUnits,
ContractServices, ContractTicketPurchases, DeletedTaskActivityLogs,
DeletedTicketActivityLogs, DeletedTicketLogs, DocumentAttachments,
DocumentChecklistItems, DocumentChecklistLibraries,
DocumentChecklistLibrariesChild, DocumentConfigurationItemAssociations,
DocumentConfigurationItemCategoryAssociations, DocumentNotes,
DocumentPlainTextContent, DocumentTagAssociations, DocumentTicketAssociations,
DocumentToArticleAssociations, DocumentToDocumentAssociations, Documents,
ExpenseItemAttachments, ExpenseItems, ExpenseReportAttachments, Holidays,
InternalLocations, InventoryItemSerialNumbers, InventoryStockedItems,
InventoryStockedItemsAddChild, InventoryStockedItemsRemoveChild,
InventoryStockedItemsTransferChild, InventoryTransfers, InvoiceTemplates,
KnowledgeBaseArticles, NotificationHistory, OpportunityAttachments,
OrganizationalResources, Phases, ProductNotes, ProductTiers, ProductVendors,
ProjectAttachments, ProjectCharges, ProjectNoteAttachments, ProjectNotes,
PurchaseOrderItemReceiving, PurchaseOrderItemReceivingChild, PurchaseOrderItems,
QuoteItems, QuoteTemplates, ResourceAttachments, ResourceDailyAvailabilities,
ResourceRoleDepartments, ResourceRoleQueues, ResourceRoles,
ResourceServiceDeskRoles, ResourceSkills, ResourceTimeOffApprovers,
SalesOrderAttachments, ServiceBundleServices, ServiceCallTaskResources,
ServiceCallTasks, ServiceCallTicketResources, ServiceCallTickets,
ServiceLevelAgreementResults, ShippingTypes, Skills, SubscriptionPeriods,
SurveyResults, Surveys, TagAliases, TaskAttachments, TaskNoteAttachments,
TaskPredecessors, TaskSecondaryResources, Tasks, TicketAdditionalConfigurationItems,
TicketAdditionalContacts, TicketAttachments, TicketCategoryFieldDefaults,
TicketChangeRequestApprovals, TicketCharges, TicketChecklistItems,
TicketChecklistLibraries, TicketChecklistLibrariesChild, TicketHistory,
TicketNoteAttachments, TicketNoteWebhookExcludedResources,
TicketNoteWebhookFields, TicketNotes, TicketRmaCredits, TicketSecondaryResources,
TicketTagAssociations, TicketWebhookExcludedResources, TicketWebhookFields,
TicketWebhookUdfFields, TimeEntryAttachments, TimeOffRequests,
TimeOffRequestsRejectChild, UserDefinedFieldListItems
```

### Read-only — 25 entities

```
ApiVersion, AuthenticateApiIntegration, AutotaskVersionApiIntegration,
ContractServiceBundleUnitsChild, ContractServiceUnitsChild,
InventoryStockedItemsAdd, InventoryStockedItemsRemove,
InventoryStockedItemsTransfer, InvoiceMarkupApiIntegration,
MetadataApiIntegration, ModuleAccessApiIntegration, OrganizationalResourcesChild,
ResourceRolesChild, ResourceTimeOffAdditional, ResourceTimeOffApproversChild,
ResourceTimeOffBalances, ResourceTimeOffBalancesChild,
ServiceLevelAgreementResultsChild, SubscriptionPeriodsChild,
ThresholdApiIntegration, TicketCategoryFieldDefaultsChild,
TimeOffRequestsApprove, TimeOffRequestsApproveChild, TimeOffRequestsReject,
ZoneInformationApiIntegration
```

### Child-only / Other — 66 entities

Entities whose parent provides the only write paths (e.g. `POST Companies/{parentId}/Attachments`).
The child tag itself only has GET paths. Examples: `CompanyAttachmentsChild`,
`TicketAttachmentsChild`, `WebhookEventErrorLogs`.

---

## URL Patterns

The swagger uses two URL patterns for every entity:

```
/V1.0/{Entities}/query          GET  — filter query (URL-parameter form)
/V1.0/{Entities}/query          POST — filter query (body form, preferred)
/V1.0/{Entities}/{id}           GET  — get by ID
/V1.0/{Entities}/{id}           PATCH — update
/V1.0/{Entities}/{id}           DELETE — delete
/V1.0/{Entities}                POST  — create

# Child resources
/V1.0/{ParentEntities}/{parentId}/{ChildEntities}/query   POST
/V1.0/{ParentEntities}/{parentId}/{ChildEntities}/{id}    GET/PATCH/DELETE
/V1.0/{ParentEntities}/{parentId}/{ChildEntities}         POST
```

---

## How to Use This File for Development

### Finding a missing entity

```bash
# Check if an entity exists and what methods it has
python3 -c "
import json
with open('autotask-swagger.json') as f: data = json.load(f)
target = 'Tickets'  # change this
for path, methods in data['paths'].items():
    for method, spec in methods.items():
        if isinstance(spec, dict) and target in spec.get('tags', []):
            print(method.upper(), path)
"
```

### Getting field names for a model

```bash
python3 -c "
import json
with open('autotask-swagger.json') as f: data = json.load(f)
model = data['definitions'].get('TicketModel', {})  # change model name
for field, schema in model.get('properties', {}).items():
    print(field, '-', schema.get('type','?'), '| required:', field in model.get('required',[]))
"
```

### Finding what's not yet implemented

Compare swagger entity tags against `nodes/Autotask/constants/entities.ts`.
The swagger has 382 tags; the node currently implements ~120.

---

## Current Implementation Gap

The node implements approximately 120 of the 382 swagger entities. Major unimplemented
areas include:

- **Knowledge Base** (Articles, ArticleNotes, ArticleAttachments, etc.)
- **Documents** (Documents, DocumentNotes, DocumentChecklistItems, etc.)
- **Sales** (Quotes, QuoteItems, QuoteLocations, SalesOrders, Opportunities expanded)
- **Inventory** (InventoryItems, InventoryProducts, InventoryStockedItems, etc.)
- **Expenses** (ExpenseReports, ExpenseItems, ExpenseItemAttachments)
- **Purchase Orders** (PurchaseOrders, PurchaseOrderItems, PurchaseOrderItemReceiving)
- **Service Calls** (ServiceCalls, ServiceCallTasks, ServiceCallTickets, etc.)
- **Price Lists** (PriceListProducts, PriceListRoles, PriceListServices, etc.)
- **Tags** (Tags, TagGroups, TagAliases)
- **Resources expanded** (ResourceSkills, ResourceDailyAvailabilities, ResourceTimeOff*)
- **Time Off** (TimeOffRequests, TimeOffRequestsApprove, TimeOffRequestsReject)
- **Surveys** (Surveys, SurveyResults)
- **Subscriptions** (Subscriptions, SubscriptionPeriods)
