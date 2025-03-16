# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

## [Unreleased]

### Todo
- [ ] Add support for Contracts child entities
- [ ] Add support for Opportunities entity (https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/OpportunitiesEntity.htm)
- [ ] Add webhook support for real-time event processing

## [0.3.1] - 2025-03-18

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
  - Note: Requires setting the `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` environment variable

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

[0.3.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.1
[0.3.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.3.0
[0.2.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.2.1
[0.2.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.2.0
[0.1.1]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.1.1
[0.1.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.1.0 
