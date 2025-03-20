# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

## [Unreleased]

 
### Todo
- [ ] Add support for Configuration items (assets)
  - ConfigurationItems
  - ConfigurationItemBillingProductAssociations
  - ConfigurationItemCategories
  - ConfigurationItemCategoryUdfAssociations
  - ConfigurationItemDnsRecords
  - ConfigurationItemNoteAttachments
  - ConfigurationItemNotes
  - ConfigurationItemRelatedItems
  - ConfigurationItemSslSubjectAlternativeName
  - ConfigurationItemTypes
- [ ] Add support for remaining Contracts child entities:
  - ContractBillingRules
  - ContractExclusionBillingCodes
  - ContractExclusionRoles
  - ContractExclusionSetExcludedRoles
  - ContractExclusionSetExcludedWorkTypes
  - ContractExclusionSets
  - ContractRetainers
  - ContractRoleCosts
  - ContractServiceAdjustments
  - ContractServiceBundleAdjustments
  - ContractServiceBundles
  - ContractServiceBundleUnits
  - ContractTicketPurchases
- [ ] Make resource description more detailed
- [ ] Add webhook support for real-time event processing


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


## [0.3.4] - 2024-03-19

### Changed
- Updated README to include comprehensive documentation for all features
  - Added new section on reference field enrichment
  - Added new section on column selection
  - Added new example for using column selection and reference labels together
  - Added missing resources to the supported resources list
  - Improved documentation for performance optimisation

## [0.3.3] - 2024-03-18

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

## Upcoming Changes

This section outlines planned features and improvements for future releases.

### Planned Entity Support
- **Contract**: Manage service contracts and agreements
- **Contract Service**: Manage services within contracts
- **Contract Service Bundle**: Manage service bundles for contracts
- **Contract Service Adjustment**: Manage adjustments to contract services
- **Opportunity**: Manage sales opportunities
- **Ticket Additional Contact**: Manage additional contacts for tickets
- **Ticket Note**: Manage notes attached to tickets
- **Ticket Secondary Resource**: Manage secondary resources assigned to tickets

### Planned Features
- **Webhook Support**: Integration with Autotask webhooks for real-time event processing

[0.3.4]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.4
[0.3.3]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.3
[0.3.2]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.2
[0.3.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.1
[0.3.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.0
[0.2.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.2.1
[0.2.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.2.0
[0.1.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.1.1
[0.1.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.1.0
[0.4.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.4.0 
