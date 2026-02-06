# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

## [1.5.1] - 2026-02-06

### Fixed

- Fixed double trailing slash in child entity API URLs (e.g. `Companies/{id}/Notes//`) caused by `processEndpointPath` being called twice — once in URL builders and again in `autotaskApiRequest`. Made the function idempotent by stripping trailing slashes before processing.
- Fixed `body.id` sent as string `'0'` instead of number `0` for child entity create operations, matching the Autotask API's `long` datatype expectation.


## [1.5.0] - 2026-02-06

### Added

- **Time Entry: Get Posted / Get Unposted** — New operations on the Time Entry resource to list labour entries by posting status. Cross-references TimeEntries with BillingItems (type Labour and Labour Adjustment; Autotask has no posted-status field on TimeEntry). Reuses Get All, Max Records, picklist labels, reference labels, select columns, and flatten UDFs options.
- **Zone: Australia / New Zealand (Sydney — from 11 Mar 2026)** — New zone option (API: webservices29.autotask.net) for the Autotask AUS/NZ datacentre migration (11 March 2026). For this zone: User interface ww29.autotask.net; Data Warehouse reports29.autotask.net; Performance Analytics workbooks workbooks29.autotask.net.


## [1.4.5] - 2026-02-02

### Fixed

- Corrected AI Helper `describeResource` to use Autotask field metadata for `isPickList`, so boolean fields like `isBillableToCompany` are no longer treated as picklists, preventing spurious \"Only picklist fields have selectable values\" errors during create/update operations.


## [1.4.4] - 2026-01-26

### Fixed

- Fixed AI Helper `describeResource` to include all dependent picklist values (e.g., `subIssueType`) with their `parentValue` mappings, regardless of picklist size. Previously, picklists with >50 values were excluded. Also updated `listPicklistValues` and internal picklist helpers to preserve `parentValue` throughout the codebase, enabling proper parent-child relationships like Issue Type to Sub Issue Type.
- Fixed circular dependency causing node loading to hang by using dynamic imports for `FieldProcessor` in `output-mode.ts` and lazy initialisation of `GetManyOperation` in `value-helper.ts`, breaking the dependency cycle between output-mode → field-processor → entity-values → value-helper → get-many → output-mode.


## [1.4.3] - 2026-01-21

### Fixed
- Removed the `Values to Send` resource mapper UI from the Ticket History `getMany` operation, as TicketHistory queries are restricted by the Autotask API to a single `ticketID equals` filter and do not support selecting fields to send.

## [1.4.2] - 2026-01-21

### Fixed
- Restored User Defined Field (UDF) support in resource mapper and \"Select Columns Names or IDs\" for all UDF-capable entities (including Companies, Contacts, Contracts, Opportunities, Projects, Services, Subscriptions and Tasks) by correctly flagging them with `hasUserDefinedFields` in entity metadata, while keeping UDF loading disabled for entities that do not support it (e.g. attachment resources).


## [1.4.1] - 2026-01-10

### Added

- Added Time Entry Attachment resource for managing files attached to time entries.
- Time Entry Attachment resource supports: create, get many, count, download, and delete operations.


## [1.4.0] - 2026-01-10

### Added

- Added Ticket Attachment resource for managing files attached directly to tickets.
- Added Ticket Note Attachment resource for managing files attached to ticket notes.
- Both attachment resources support: create, get many, count, download, and delete operations.
- Shared attachment helper utilities (`helpers/attachment.ts`) for future attachment types.
- File size validation (6MB limit) for attachment uploads.

### Fixed

- Fixed multiple helpers attempting to fetch User Defined Fields (UDFs) for entities that don't support them (e.g. TicketAttachment), causing 404 errors. Affected: resource mapper, filter builder, AI helper, field processor, and body builder. All now check entity metadata before fetching UDF fields.

## [1.3.1] - 2025-12-14

### Fixed

- Fixed dry run option appearing for read operations (get, getMany, getManyAdvanced). Dry run now only appears for write operations (create, update, delete) as intended. Removed dry run handling from read operation classes since the option is not available for these operations.

## [1.3.0] - 2025-12-14

### Added

- Added dry run option for all write operations (create, update, delete). When enabled, returns a preview of the request that would be sent without making any changes to Autotask. Useful for testing and validation.

## [1.2.6] - 2025-11-23

### Fixed

- Fixed double throttling bug in rate limiter that was applying delays twice
- Fixed counter decrement logic in threshold sync to correctly track API usage
- Consolidated counter reset logic to prevent race conditions
- Improved rate limit handling: now waits for rolling 60-minute window to reset instead of just 5 seconds
- Added maximum wait timeout (10 minutes) to prevent infinite blocking when at rate limit
- Added specific error handling for 429 Too Many Requests responses with clear error messages

### Improved

- Enhanced rate limiting with proper wait-until-reset logic when limit is reached
- Added automatic API threshold syncing every 30 seconds during rate limit waits
- Improved documentation for rate limiting, thread limiting, and threshold information bypass


## [1.2.5] - 2025-11-06

### Fixed

- Prevent parent ID lookups failing in auto-map mode by passing parent ID directly from validated payload to URL builder for child entity create/update operations (affects Contact and other child resources). Also enforces strict typing on the override value.

## [1.2.4] - 2025-11-06

### Fixed

- Auto-map mode now uses incoming item data and ignores node mappings
- Includes all schema-matching fields (even if marked removed in UI)
- `bodyJson` still overrides auto-mapped values

## [1.2.3] - 2025-10-16

### Fixed

- Improved error logging to sanitise sensitive information in debug output



## [1.2.2] - 2025-10-04

### Fixed

- **Field mapping expression errors now properly fail the node**: Previously, expression errors (e.g., referencing unexecuted nodes) were silently caught and only logged to console, causing the node to show success in UI while sending empty API requests. Expression errors now correctly propagate to the UI with helpful error messages.

## [1.2.1] - 2025-09-16

### Added
- Added support for ContractExclusionSets entity with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing reusable sets of roles and work types that are excluded from contracts
- Enhanced field processing for Contract entities by whitelisting contractPeriodType and exclusionContractID fields for create operations despite being marked read-only

## [1.2.0] - 2025-09-16

### Added
- Added support for TicketCharges entity as a child resource of Tickets with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations, where Update and Delete operations are only allowed when isBilled = false
- Added support for TicketChecklistItems entity as a child resource of Tickets with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing checklist items on Autotask tickets
- Added support for TicketChecklistLibraries entity as a child resource of Tickets with Create operation only, allowing all items from a checklist library to be added to a ticket (appends to existing checklist items)
- Added support for ChecklistLibraries entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing modular checklist components that can be applied to tickets or tasks
- Added support for ChecklistLibraryChecklistItems entity as a child resource of ChecklistLibraries with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing individual checklist items within checklist library templates
- Added support for ClassificationIcons entity as a read-only standalone resource with Get, GetMany, GetManyAdvanced, and Count operations for querying classification icons used in Autotask for categorizing and visually identifying different types of items
- Added support for Tags entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing ticket and article tags with unique label requirements and system tag protections
- Added support for TagGroups entity as a standalone resource with Create, Update, Delete, Get, GetMany, GetManyAdvanced, and Count operations for organizing tags into categories with unique labels, display colors, and system group protections
- Added support for TagAliases entity as a child resource of Tags with Create, Delete, Get, GetMany, GetManyAdvanced, and Count operations for managing alternative names for tags to improve searchability with unique Tag ID/Alias combinations

## [1.1.0] - 2025-09-03

### Added
- **Enhanced AI Tool Effectiveness**: Major improvements to Tool and AI Helper resources for n8n AI node compatibility
  - **Static Tool Surface**: Added `TOOL_OPERATION_OPTIONS` with all 100+ resource-operation combinations for immediate AI enumeration
  - **Capability Discovery**: New `listCapabilities` operation in AI Helper for comprehensive API introspection
  - **Proactive Validation**: Automatic parameter validation for create/update operations with helpful error guidance
  - **Safety Gates**: Configurable restrictions with `allowWriteOperations`, `allowDryRunForWrites`, and `allowedResourcesJson`
  - **Enhanced Hints**: Proactive parameter hints pointing to appropriate AI Helper functions
  - **AI Resource Discoverability**: Removed `displayOptions.show.resource` gating for Tool and AI Helper resources

### Changed
- **BREAKING: Tool Resource**: Redesigned with simple string/JSON parameters for AI Node compatibility
- **Tool > Execute safety gating**: Centralised enforcement for:
  - `Allow Write Operations` (default false) blocks create/update/delete unless explicitly enabled
  - `Allow Dry Run for Writes` (default true) permits dry-run previews when writes are blocked
  - `Allowed Resources (JSON)` restricts execution to an allow-list (case-insensitive)
  - `Dry Run` returns structured previews without calling the API

### Fixed
- **Delete dry-run behaviour**: 
  - Tool > Execute now returns a structured delete preview when `dryRun` is enabled instead of executing the request
  - Base delete operation respects `dryRun` and no longer issues DELETE requests when enabled
- **AI Helper resource picklists**: Fixed AI Helper resource name fields to display as proper dropdown picklists instead of empty autocomplete inputs by changing field type from 'string' to 'options'
- **AI Helper List Picklist Values**: Enhanced operation with parameter validation, improved UDF field detection, better error handling with helpful messages, and enriched response metadata including pagination info and field details
- **Fixed AI parameter isolation**: Prevented AI-specific `selectColumnsJson` parameter from interfering with regular resource mapper picklist loading
- **Resource Mapper Manual Mode**: Fixed auto-population of fields in "map each column manually" mode across all resources

## [0.9.9] - 2025-09-01

### Added
- Added support for Billing items resources
 - Invoice special endpoints:
   - Get PDF: download invoice as a PDF (`InvoicePDF`)
   - Get Markup (HTML): retrieve invoice markup (`InvoiceMarkupHtml`)
   - Get Markup (XML): retrieve invoice markup (`InvoiceMarkupXML`)
   - Exposed as new operations on the Invoice resource; responses are returned as binary data with `fileName` and `contentType` for downstream use


## [0.9.8] - 2025-08-29

### Added
- Added support for Subscription and Subscription Periods resources


## [0.9.7] - 2025-08-24

### Changed
- Updated AI Helper and Tool resources to better align with AI Agent node operational requirements
- Removed AI centric inputs from all resoruces other than AI Helper and Tool resource


## [0.9.6] - 2025-08-17

### Added
- **AI Agent-Friendly Improvements**: Comprehensive enhancements for AI/tool-calling systems including:
  - **AI Helper Resource**: New `aiHelper` resource with `describeResource`, `listPicklistValues`, and `validateParameters` operations for runtime introspection
  - **JSON Parameter Fallbacks**: `bodyJson` and `selectColumnsJson` parameters to override UI mappings with structured JSON input
  - **Output Modes**: `rawIds`, `idsAndLabels`, `labelsOnly` options for token-efficient responses  
  - **Dry-Run Support**: Request preview functionality across all operations without API execution
  - **Dynamic Dependency Discovery**: Automatic entity relationship mapping and field dependency detection
  - **JSON Schema Validation**: Immediate feedback on malformed JSON parameters
  - **Enhanced Error Hints**: Structured error responses with actionable suggestions for AI self-correction
  - **Agent Playbook Documentation**: Comprehensive guide for AI agent integration and best practices
  - **Label-to-ID Resolution on Writes**: `bodyJson` can now accept picklist/reference labels; values are pre-flight resolved to IDs using introspection and lookups
  - **Reference Alias Tolerance**: Improved reference detection to accept common variants/typos (e.g. `resrouce`, `assignedresource`, `accountManager`, `account_manager`) and map them correctly

### Changed
- **Consistent Output Shaping**: Applied `outputMode` processing to create/update responses for consistency with read operations
- **Agent Hints (Read Ops)**: Expanded agent-friendly hints in read paths (e.g. empty/invalid responses) to aid self-correction

## [0.9.5] - 2025-08-11

### Changed
- Resolved merge conflicts and bumped version to 0.9.5. Preserved all changes from 0.9.3 and 0.9.4.

## [0.9.4] - 2025-08-11

### Fixed
- Fixed a bug where Assets (Configurtion items) Webhook errored with "Invalid entity type. Received InstalledProduct, expected ConfigurationItems."

## [0.9.3] - 2025-08-07

### Added
- Added support for CompanySiteConfigurations endpoint support for:
  - **Update**: Modify site configuration settings and user-defined fields for customer companies
  - **Get**: Retrieve individual site configuration by ID
  - **Get Many**: Query multiple site configurations with filtering support
  - **Count**: Count site configurations matching specific criteria
  - **Entity Info**: Access field definitions and metadata
  - Full User-Defined Fields (UDF) support with Protected Data Permissions (DPP) compliance
  - Parent-child relationship support with Companies entity

## [0.9.2] - 2025-07-31

### Fixed
- Fixed a bug where UDFs selected in the resource mapper for `Get Many` and `Count` operations were not being correctly identified, causing API errors.

## [0.9.1] - 2025-07-23

### Changed
- Increased maximum page count from 50 to 1000
- Refactored pagination to use iterative loops instead of recursion for large data sets.

### Fixed

## [0.9.0] - 2025-07-10

### Fixed
- Enhanced date/time handling in Search Filter's Build and Dynamic Build operation, building on v0.8.9 fix: now thoroughly converts input and output dates consistently between timezones using credentials' configured timezone, ensuring all dates sent to Autotask API are in UTC as required.

## [0.8.9] - 2025-07-10

### Fixed
- Prevented double UTC conversion for date values in the Search Filter's Dynamic Build operation.

## [0.8.8] - 2025-07-05

### Changed
- Performance improvement for getMany operations: reference and picklist enrichment now fetches only required entities, not all.

## [0.8.7] - 2025-07-05
### Fixed
- Resolved an issue where reference fields were exclusively enriched from active records; now supports enrichment from inactive records when required. Additionally, ensured that display fields for inactive reference records are properly retrieved for accurate label generation (e.g., resource names instead of "Resource #ID") by ensuring correct ID type handling during lookup. Picklists continue to be populated from active records only.

## [0.8.5] - 2025-07-01
### Changed
- Performance: Continued UI-performance tuning for large workflows – the "Select Columns" dropdown now renders **only** the fields you pick (`showOnlySelected`) and includes in-dropdown search capabilities.  This further reduces DOM load and improves NDV responsiveness when hundreds of Autotask fields are available.

## [0.8.4] - 2025-06-30
### Changed
- Performance: Introduced provisional in-memory memoisation and pick-list trimming for the "Select Columns" dropdown as part of ongoing UI-performance tuning for larger workflows.

## [0.8.3] - 2025-06-29

### Added
- Added support for `Countries` entity to enable `CountryID` reference field enrichment.

### Changed
- Modified the display name format for several reference fields to provide a cleaner and more consistent UI:
  - **Resource**: Changed from `FirstName LastName [Email] [ID]` to `FirstName LastName`.
  - **Contact**: Changed from `FirstName LastName [Email]` to `FirstName LastName`.
  - **Ticket**: Changed from `TicketNumber - Title` to `Title [TicketNumber]`.

## [0.8.2] - 2025-05-24

### Fixed
- Fixed ID validation for get and delete operations: IDs of 0 are now accepted as valid values

## [0.8.1] - 2025-05-10

### Added
- Added support for ServiceCallTasks, ServiceCallTickets, ServiceCallTaskResources and ServiceCallTicketResources entities

## [0.8.0] - 2025-05-09

### Added
- Added support for Quotes, QuoteItems, QuoteLocations and QuoteTemplates entities

## [0.7.4] - 2025-04-21

### Added
- Added structured metadata to nodes for better categorisation

## [0.7.3] - 2025-04-18

### Fixed
- Fixed issue with custom URL not being used for pagination requests:
  - Modified request handling to use custom URL consistently for all API calls
  - Fixed pagination URLs to work properly with proxy/custom URL configurations
  - Ensures all requests in a paginated sequence use the same base URL

## [0.7.2] - 2025-04-17

### Fixed
- Updated documentation in README:
  - Corrected Advanced Example for Complex Filtering with Get Many Advanced operation

## [0.7.1] - 2025-04-17

### Changed
- Updated "Other (Use Zone Information API)" option in credentials to "Other (Custom URL)":
  - Modified the credential option to better reflect its actual functionality
  - The custom URL is now used directly without any zone lookup

## [0.7.0] - 2025-04-14

### Fixed
- Improved error handling to display specific API error messages in n8n UI:
  - Enhanced error extraction from API responses for all status codes

## [0.6.9] - 2025-04-13

### Added
- Enhanced Search Filter resource with new "Dynamic Build" operation:
  - Added entity-driven field selection workflow distinct from standard "Build" operation
  - Implemented dynamic field loading based on entity selection
  - Added UDF field support with clear type indicators

## [0.6.8] - 2025-04-12

### Fixed
- Improved API error handling:
  - Enhanced error messages to include complete API error context
  - Fixed issue where original API error details weren't displayed to users

## [0.6.7] - 2025-04-12

### Fixed
- Fixed UI field reloading when resource or operation changes:
  - Added loadOptionsDependsOn property to "Select Columns" option
  - Added loadOptionsDependsOn to "Add Picklist Labels" option
  - Added loadOptionsDependsOn to "Add Reference Labels" option
  - Added loadOptionsDependsOn to "Flatten User-Defined Fields" option
  - Added loadOptionsDependsOn to "Get All" (returnAll) option
  - Added loadOptionsDependsOn to "Max Records" option
  - Added loadOptionsDependsOn to Advanced Filter option
  - Ensures all fields properly refresh when resource or operation is changed

## [0.6.5] - 2025-04-11

### Added
- Added support for Roles entity
- Added support for ContractBillingRules entity
- Added support for ContractExclusionBillingCodes entity:
- Added support for ContractRoleCosts entity
- Added support for ContractExclusionRoles entity
- Added support for ContractExclusionSetExcludedRoles entity
- Added support for ContractExclusionSetExcludedWorkTypes entity
- Added support for ContractExclusionSets entity
- Added support for ContractRetainers entity
- Added support for ContractServiceAdjustments entity
- Added support for ContractServiceBundleAdjustments entity
- Added support for ContractServiceBundles entity
- Added support for ContractServiceBundleUnits entity
- Added support for ContractTicketPurchases entity
- Added support for DomainRegistrars entity
- Added support for Invoices entity
- Added support for ProductVendors entity
- Added support for NotificationHistory entity
- Added support for ContactGroups entity
- Added support for ContactGroupContacts entity


### Fixed
- Fixed issue with reference type fields not populating in resource mapper:
  - Modified FieldProcessor to properly handle reference field loading in resource mapper context
  - Ensures reference picklists are populated consistently like regular picklists
  - Improves field selection experience by showing all available reference values
  - Previously, reference fields appeared empty while regular picklists worked fine

## [0.6.4] - 2025-04-11

### Added
- Added support for ResourceRole entity:
  - Enables retrieval of department/role relationships, service desk queues, and service desk roles

## [0.6.3] - 2025-04-09

### Fixed
- Fixed DateTime handling in search filter operations:
  - Fixed issue where DateTime values with time components were being truncated to just date
  - Modified search filter builder to preserve time information when present in input
  - Now correctly formats DateTime values with full time components in filter conditions
  - Ensures DateTime filters with specific times (e.g., 2025-04-08T19:18:19.738-04:00) are processed correctly

## [0.6.2] - 2025-04-06

### Fixed
- Fixed webhook signature verification failing with non-English characters:
  - Enhanced Unicode character handling to properly escape all non-ASCII characters
  - Fixed webhook verification issues when payloads contain accented characters (é, è, etc.)
  - Added proper encoding of all Unicode characters to match Autotask's escaping format
  - Resolved signature validation failures with French and other non-English text content
  - Improved compatibility with international character sets in all webhook operations

## [0.6.1] - 2025-04-02

### Added
- Added support for Autotask API thread limiting with per-endpoint concurrency control
- Added warning notices about API limits in webhook configuration UI
- Improved webhook field and resource selection with API limit warnings

### Fixed
- Fixed thread tracking for API endpoints to respect Autotask's 3-thread limit per endpoint


## [0.5.9] - 2025-04-01

### Added
- Added API Threshold resource for checking API usage limits:
  - Added new 'API Threshold' resource with a single 'Get API Usage' operation
  - Provides information about current API usage, limits, and remaining requests
  - Returns usage statistics including:
    - Current usage count
    - Maximum threshold (limit)
    - Usage percentage
    - Usage level (Normal, Moderate, High, Critical)
    - Remaining available requests
    - Timeframe duration


## [0.5.8] - 2025-04-01

### Fixed
- Improved webhook creation error handling:
  - Added field/resource configuration retries (3 attempts with exponential backoff)
  - Fixed detection of field configuration failures
  - Implemented automatic cleanup of partial webhooks on failure
  - Enhanced error reporting and validation


## [0.5.7] - 2025-03-31

### Fixed
- Added version-aware caching to ensure cache invalidation on node updates


## [0.5.6] - 2025-03-30

### Fixed
- Fixed issue with webhook field configurations:
  - Resolved problem where fields selected in both Subscribed Fields and Always Display Fields were not configured correctly
  - Modified implementation to allow fields to have both isSubscribedField and isDisplayAlwaysField flags set to true
  - Updated field processing logic to handle fields that appear in both selection lists
  - Ensures all selected fields appear in the Autotask webhook configuration as expected
  - Improves consistency between n8n UI configuration and Autotask webhook settings

## [0.5.5] - 2025-03-29

### Fixed
- Fixed entity type handling in webhook processing:
  - Added missing entity type aliases for singular-to-plural mapping
  - Resolved "Invalid entity type. Received Ticket, expected Tickets" error
  - Added support for "Ticket", "Contact", "ConfigurationItem", and "TicketNote" to match their plural counterparts
  - Ensures consistent webhook handling across all entity types
  - Improves reliability for all webhook trigger operations

## [0.5.4] - 2025-03-28

### Added
- Added support for Ticket Webhook operations:
  - Added TicketWebhook entity and related entities to support webhook management
  - Implemented webhook resource operations for tickets:
    - Get webhook by ID
    - Get multiple webhooks
    - Delete webhooks
  - Added support for webhook field configuration and excluded resources
  - Follows the same pattern as other webhook-enabled entities (Company, Contact, etc.)
  - Enables real-time ticket event notifications through the AutotaskTrigger node

### Fixed
- Fixed issue with ticket webhook creation in AutotaskTrigger node
  - Resolved error "Invalid entity type. Received Ticket, expected Tickets"
  - Updated entity type validation to handle plural form correctly
  - Ensures webhook creation works consistently across all supported entities

## [0.5.3] - 2025-03-26

### Fixed
- Fixed issue with "Select Columns Names or IDs" option being ignored in get (get by ID) operations
  - Modified get operations to use query endpoint with ID filter when columns are selected
  - The fix ensures that column selection works properly across all get operations
  - This workaround addresses a limitation in the Autotask API where IncludeFields parameter is ignored in get-by-ID endpoint

## [0.5.2] - 2025-03-26

### Fixed
- Removed client-side filtering from all get operations when using IncludeFields parameter
  - Fixed issue where User Defined Fields (UDF) would not be properly returned in responses
  - Improved operation classes to rely solely on server-side filtering via API IncludeFields parameter
  - Optimised all get operations (Get, GetMany, GetManyAdvanced) for more reliable handling of UDF fields
  - Ensures all selected fields, including UDF fields, are properly included in API responses

### Added
- Added UDF flattening option for get operations
  - New "Flatten User-Defined Fields" toggle for get, getMany, and getManyAdvanced operations
  - When enabled, brings UDF fields up to the top level of each object for easier access
  - Makes UDFs directly accessible as top-level properties instead of being nested in the userDefinedFields array
  - Maintains original userDefinedFields array for backward compatibility

## [0.5.1] - 2025-03-25

### Added
- Added "Who Am I" operation to Resources entity
  - Retrieves the resource details of the API user specified in the node credentials
  - Extracts username from credentials email and queries matching resources
  - Supports standard options: Add Picklist Labels, Add Reference Labels, and Select Columns

## [0.5.0] - 2025-03-25

### Added
- Comprehensive webhook support:
  - Added AutotaskTrigger node for receiving webhook events
  - Added support for webhooks across all supported entities:
    - Company
    - Contact
    - Configuration Item
    - Ticket
    - Ticket Note
  - Added webhook resource operations for the supported entities:
    - Get webhook by ID
    - Get multiple webhooks
    - Delete webhooks
  - Implemented webhook field configuration for controlling payload contents
  - Added resource exclusion capabilities to filter webhook events
  - Added email notifications for webhook delivery failures
- Made resource descriptions more detailed with improved clarity and context

## [0.4.1] - 2025-03-21

### Added
- Added support for:
  - Surveys entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/SurveysEntity.htm)
  - SurveyResults entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/SurveyResultsEntity.htm)
  - ConfigurationItems entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm)
  - ConfigurationItemTypes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemTypesEntity.htm)
  - ConfigurationItemCategories entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemCategoriesEntity.htm)
  - ConfigurationItemNotes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemNotesEntity.htm)
  - ConfigurationItemRelatedItems entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemRelatedItemsEntity.htm)
  - ConfigurationItemDnsRecords entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemDnsRecordsEntity.htm)
  - ConfigurationItemBillingProductAssociations entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemBillingProductAssociationsEntity.htm)
  - ConfigurationItemCategoryUdfAssociations (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemCategoryUdfAssociationsEntity.htm)
  - ConfigurationItemSslSubjectAlternativeName (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ConfigurationItemSslSubjectAlternativeNameEntity.htm)

## [0.4.0] - 2025-03-20

### Added
- Added support for ContractCharges entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractChargesEntity.htm)
- Added support for ContractMilestones entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractMilestonesEntity.htm)
- Added support for ContractNotes entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractNotesEntity.htm)
- Added support for ContractServices entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractServicesEntity.htm)
- Added support for ContractServiceUnits entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractServiceUnitsEntity.htm)
- Added support for ContractBlocks entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractBlocksEntity.htm)
- Added support for ContractBlockHourFactors entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractBlockHourFactorsEntity.htm)
- Added support for ContractRates entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContractRatesEntity.htm)
- Added support for Services entity (https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ServicesEntity.htm)


## [0.3.4] - 2025-03-19

### Changed
- Updated README to include comprehensive documentation for all features
  - Added new section on reference field enrichment
  - Added new section on column selection
  - Added new example for using column selection and reference labels together
  - Added missing resources to the supported resources list
  - Improved documentation for performance optimisation

## [0.3.3] - 2025-03-18

### Added
- Added column selection for get operations
  - New "Select Columns" option for get, getMany, and getManyAdvanced operations
  - Allows selection of specific fields to return in the response
  - Uses the same field definitions as the resource mapper
  - Improves performance by reducing response payload size
- Added reference field enrichment for get operations
  - New "Add Reference Labels" option for get, getMany, and getManyAdvanced operations
  - Automatically adds "_label" fields with human-readable values for all standard picklist fields
  - Works just like picklists but for references to other entities
  - Provides friendly names instead of just IDs for related entities
- Added date value type to search filter resource
  - Enhanced filtering capabilities by allowing date-based queries
  - Compatible with various date formats including ISO 8601
  - Automatically converts date inputs to Autotask API format
  - Added date picker UI for improved user experience

### Fixed
- Fixed issue where "Add Picklist Labels" and "Add Reference Labels" options didn't work when "Select Columns" was used
  - Label fields (_label suffix) are now included when their base field is selected
  - Added additional logging for troubleshooting column selection issues
  - Improved field filtering logic to maintain relationships between fields
- Date values in search filters now properly respect timezone settings from credentials
  - Fixed inconsistency where search filter dates were not being converted from local timezone to UTC
  - All date operations now consistently use the configured timezone
- Fixed date conversion issue in getManyAdvanced operation
  - Resolved a problem where date fields weren't being converted correctly when picklist labels were added
  - Modified both getManyAdvanced and getMany operations to ensure date conversion always happens
