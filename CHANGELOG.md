# Changelog

All notable changes to the n8n-nodes-autotask project will be documented in this file.

## [0.1.1] - 2024-02-26

### Added
- Added support for limiting the number of records returned in query operations
- Added "Get All" toggle to control whether to retrieve all results or only up to a specified limit
- Added "Max Records" parameter (range 1-500, default 10) when "Get All" is set to false

### Fixed
- Fixed an issue with the MaxRecords parameter not being included in API requests

## [0.1.0] - 2024-02-25

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

[0.1.0]: https://github.com/msoukhomlinov/n8n-nodes-autotask/releases/tag/v0.1.0 
