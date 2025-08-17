# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

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
  - Automatically adds "_label" fields with human-readable values for reference fields
  - Works just like picklist labels but for references to other entities
  - Provides friendly names instead of just IDs for related entities
- Added date value type to search filter resource
  - Enhanced filtering capabilities by allowing date-based queries
  - Compatible with various date formats including ISO 8601
  - Automatically converts date inputs to Autotask API format
  - Added date picker UI for improved user experience
- Improved UI for search filter values
  - Added date picker for date values
  - Added toggle switch for boolean values
  - Makes creating complex filters more intuitive

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

## [0.3.2] - 2025-03-16

### Added
- Added support for Opportunities entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/OpportunitiesEntity.htm)

## [0.3.1] - 2025-03-16

### Added
- Added support for Company Alerts entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/CompanyAlertsEntity.htm)
- Added support for Company Locations entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/CompanyLocationsEntity.htm)
- Added support for HolidaySets entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/HolidaySetsEntity.htm)
- Added support for Holidays entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/HolidaysEntity.htm)
- Added support for Service Calls entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ServiceCallsEntity.htm)
- Added support for Contracts entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ContactsEntity.htm)
- Added support for using the node as an AI tool in n8n workflows
  - Added `usableAsTool: true` to node description
  - Added documentation on how to use the node with AI agents
  - Note: Requires setting the `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` environment variable to `true`

## [0.3.0] - 2025-03-16

### Added
- Enhanced get operations to add label fields for picklist values
  - Added `addPicklistLabels` option to get, getMany, and getManyAdvanced operations
  - Automatically adds `_label` fields with human-readable values for all standard picklist fields
  - Optimised for performance with batch processing and caching

### Fixed
- Resolved issues with caching where disabling the cache required an n8n restart to take effect
  - Cache settings now apply immediately without requiring a restart
  - Improved cache invalidation mechanism for more consistent behaviour

## [0.2.1] - 2025-03-15

### Added
- Added support for new Autotask API zones: America West 4, UK3, and Australia 2
- Added ability to enter custom zone URL when selecting "Other" option
- Added reference to official Autotask API Zones documentation

### Changed
- Updated zone selection to improve flexibility for users with custom or new zones
- Modified credential testing to support custom zone URLs

## [0.2.0] - 2025-03-12

### Added
- Enhanced caching to be file based and shareable between workflows/runs
- Added support for Billing Codes (BillingCodes) entity
- Added support for Ticket Note entity
- Added support for Ticket History entity

### Changed
- Improved performance with the new file-based caching system
- Enhanced documentation for new entities

## [0.1.1] - 2025-02-26

### Added
- Added support for limiting the number of records returned in query operations
- Added "Get All" toggle to control whether to retrieve all results or only up to a specified limit
- Added "Max Records" parameter (range 1-500, default 10) when "Get All" is set to false

### Fixed
- Fixed an issue with the MaxRecords parameter not being included in API requests

## [0.1.0] - 2025-02-25

### Added
- Initial public release of the n8n-nodes-autotask integration
- Support for 12 Autotask entities including Companies, Contacts, Projects, Tickets, and more
- Core operations (Create, Update, Delete, Count, Get, Get Many and Get Many Advanced) for most supported entities
- Advanced query capabilities with complex filtering options
- Support for parent-child relationships between entities
- Field mapping based on entity definitions
- Timezone handling with automatic conversion between local time and UTC
- Caching system for improved performance
- Comprehensive error handling and validation

### Notes
- This is the first public release of the n8n-nodes-autotask integration
- Entity support is currently limited but will likely be expanded in future versions
- The integration has had limited production testing, so it should be used with care
- Please refer to the README for detailed information on functionality and usage
