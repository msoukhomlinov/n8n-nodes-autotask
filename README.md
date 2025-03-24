# n8n-nodes-autotask

![n8n-nodes-autotask](https://img.shields.io/badge/n8n--nodes--autotask-0.5.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

This is an n8n community node for integrating with Autotask PSA. It provides a comprehensive set of operations to interact with Autotask entities through their REST API.

![Overview of n8n-nodes-autotask](./overview.gif)

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Authentication](#authentication)  
[Features](#features)  
[Usage](#usage)  
[Configuration](#configuration)  
[Limitations](#limitations)  
[Troubleshooting](#troubleshooting)  
[Resources](#resources)  
[License](#license)

## Installation

Follow these steps to install this node:

```bash
# Install with npm
npm install n8n-nodes-autotask

# Install with pnpm
pnpm install n8n-nodes-autotask
```

**Requirements:**
- n8n version 1.0.0 or later
- Node.js version 18.10 or later
- pnpm version 9.1 or later (if using pnpm)

## Authentication

To use this node, you need to have API access to your Autotask instance. Follow these steps to set up authentication:

1. In Autotask, go to **Admin > API User Security**
2. Create or select an API user
3. Note the API Integration Code, Username, and Secret
4. In n8n, create a new credential of type **Autotask API**
5. Enter your API Integration Code, Username, and Secret
6. Select your Autotask zone
7. Select your timezone (affects how dates and times are displayed and entered)
8. Configure caching options as needed (this will cache dynamically fetched field picklists)

## Features

### Supported Resources

The node supports the following Autotask resources:

| Resource | Description |
|----------|-------------|
| Billing Code | Manage billing codes for time entries and charges |
| Company | Manage organisations in Autotask |
| Company Alert | Manage alerts associated with companies |
| Company Location | Manage locations for companies |
| Company Note | Manage notes attached to companies |
| Company Webhook | Manage webhooks for company events |
| Configuration Item | Manage configuration items (CIs) for companies |
| Configuration Item Billing Product Association | Manage product associations for configuration items |
| Configuration Item Category | Manage categories for configuration items |
| Configuration Item Category UDF Association | Manage UDF associations for CI categories |
| Configuration Item DNS Record | Manage DNS records for configuration items |
| Configuration Item Note | Manage notes for configuration items |
| Configuration Item Related Item | Manage related items for configuration items |
| Configuration Item SSL Subject Alternative Name | Manage SSL alternative names for configuration items |
| Configuration Item Type | Manage types for configuration items |
| Configuration Item Webhook | Manage webhooks for configuration item events |
| Contact | Manage contacts associated with companies |
| Contact Webhook | Manage webhooks for contact events |
| Contract | Manage contracts for companies |
| Contract Blocks | Manage block hour contracts |
| Contract Block Hour Factors | Manage hour factors for block hour contracts |
| Contract Charges | Manage charges associated with contracts |
| Contract Milestones | Manage milestones for contracts |
| Contract Notes | Manage notes attached to contracts |
| Contract Rates | Manage rates for contract services |
| Contract Services | Manage services within contracts |
| Contract Service Units | Manage service units for contracts |
| Holiday | Manage holiday dates |
| Holiday Set | Manage holiday sets for resources |
| Opportunity | Manage sales opportunities |
| Product | Manage products in the catalogue |
| Project | Manage projects |
| Project Charge | Manage charges associated with projects |
| Project Note | Manage notes attached to projects |
| Project Phase | Manage phases within projects |
| Project Task | Manage tasks within projects |
| Resource | Manage staff resources |
| Search Filter | Build advanced search filters |
| Service | Manage services offered to clients |
| Service Call | Manage service calls |
| Survey | Manage customer surveys |
| Survey Result | Manage results from customer surveys |
| Ticket | Manage service tickets |
| Ticket History | View historical changes to tickets |
| Ticket Note | Manage notes attached to tickets |
| Ticket Note Webhook | Manage webhooks for ticket note events |
| Time Entry | Manage time entries for billing |

### Operations

For most resources, the following operations are available:

- **Create**: Add new records
- **Read**: Retrieve a single record by ID
- **Update**: Modify existing records
- **Delete**: Remove records
- **Get Many**: Retrieve multiple records with basic filtering options. This operation allows you to:
  - Filter records using simple field conditions (equals)
  - Filtering on User Defined Fields (UDFs)
  - Automatically paginate through large result sets
  - Choose to get all results or limit to a specific number (1-500)
  - Set a maximum number of records to return when not retrieving all records
  - Select specific columns to return in the response
  - Add human-readable labels for picklist and reference fields
- **Get Many Advanced**: Build complex queries with multiple filter conditions and logical operators. This operation provides:
  - Support for complex AND/OR logic in filters
  - Nested condition groups for sophisticated queries
  - Filtering on User Defined Fields (UDFs)
  - Advanced operators like contains, beginsWith, endsWith, exists, notExists
  - Support for IN and NOT IN operators with multiple values
  - Choose to get all results or limit to a specific number (1-500)
  - Set a maximum number of records to return when not retrieving all records
  - Select specific columns to return in the response
  - Add human-readable labels for picklist and reference fields
  - Date-based filtering with automatic timezone handling
- **Count**: Get the number of matching records
- **Get Entity Info**: Retrieve metadata about the entity
- **Get Field Info**: Retrieve field definitions for the selected entity

For webhook resources (Company Webhook, Contact Webhook, Configuration Item Webhook, Ticket Note Webhook), the following operations are available:
- **Get**: Retrieve a single webhook by ID
- **Get Many**: Retrieve multiple webhooks with basic filtering
- **Delete**: Remove a webhook

### Webhook Trigger

The node includes an Autotask Trigger node that can receive webhook events from Autotask. The trigger supports:

- Events for multiple entity types (Companies, Contacts, Tickets, Configuration Items, Ticket Notes)
- Create, Update, and Delete events
- Field selection for webhook payloads (specify which fields to include)
- Resource exclusion (exclude specific resources from triggering the workflow)
- Email notifications for webhook delivery failures
- Threshold notifications for monitoring webhook performance
- Automatic webhook registration and cleanup
- Secure payload verification with HMAC signatures

### Advanced Features

- **Resource Mapping**: Dynamically map fields based on entity definitions
- **Advanced Filtering**: Build complex queries with multiple conditions
- **Column Selection**: Choose specific fields to return in get operations
- **Picklist Label Enrichment**: Automatically add human-readable labels for picklist fields
- **Reference Label Enrichment**: Add human-readable labels for reference fields
- **File-based Caching**: Improved performance with persistent caching that can be shared between workflows and runs
- **Timezone Handling**: Automatic conversion between local time and UTC

### AI Tool Integration

This node can be used as a tool by AI agents in n8n workflows. This allows AI agents to interact with Autotask PSA, performing operations like retrieving company information, creating tickets, or updating contacts.

#### Requirements

Currently, n8n only allows core nodes to be used as tools by default. To use this community node as a tool, you need to:

1. Set the environment variable `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` to `true` when running n8n.
2. Add the Autotask node as a tool in your AI agent workflow.

#### Environment Variable Configuration

For the node to be usable as an AI tool, you must set the following environment variable:

```bash
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

This can be done by:
- Adding it to your .env file
- Setting it in your system environment variables
- Including it in your Docker or container configuration
- Adding it to your startup command (e.g., `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true n8n start`)

Without this environment variable set to `true`, n8n will not allow AI agents to use this community node as a tool.

#### Example AI Tool Usage

An AI agent might use the Autotask node to:
- Retrieve information about a company or contact
- Create a new ticket based on user input
- Update the status of an existing ticket
- Add notes to a ticket or company record
- Search for tickets matching specific criteria

## Usage

### Basic Example: Creating a Ticket

1. Add an **Autotask** node to your workflow
2. Select **Ticket** as the resource
3. Select **Create** as the operation
4. Configure the required fields (Title, Status, etc.)
5. Connect to a trigger or previous node
6. Execute the workflow

### Intermediate Example: Querying Projects with Filters

1. Add an **Autotask** node to your workflow
2. Select **Project** as the resource
3. Select **Get Many** as the operation
4. Add filter conditions (e.g., Status equals "Active")
5. Choose whether to retrieve all results or limit the number:
   - Toggle "Get All" to true to retrieve all matching records
   - Toggle "Get All" to false and set "Max Records" (1-500) to limit the results
6. Connect to a trigger or previous node
7. Execute the workflow

### Advanced Example: Using Column Selection and Reference Labels

1. Add an **Autotask** node to your workflow
2. Select **Ticket** as the resource
3. Select **Get Many** as the operation
4. Add filter conditions as needed
5. Enable **Select Columns** to choose specific fields to return
6. Select only the fields you need in the response (improves performance)
7. Enable **Add Picklist Labels** to get human-readable values for picklist fields
8. Enable **Add Reference Labels** to get human-readable values for reference fields
9. Execute the workflow to get tickets with only the selected fields and human-readable labels

### Advanced Example: Complex Filtering with Get Many Advanced

1. Add an **Autotask** node to your workflow
2. Select **Ticket** as the resource
3. Select **Get Many Advanced** as the operation
4. Build a complex filter, for example:
   ```json
   {
     "op": "and",
     "items": [
       {
         "field": "Status",
         "op": "notEqual",
         "value": 5
       },
       {
         "op": "or",
         "items": [
           {
             "field": "Priority",
             "op": "Equal",
             "value": 6
           },
           {
             "field": "DueDateTime",
             "op": "lessThan",
             "value": "{{ $now.plus(3, 'days').toLocal()}}"
           }
         ]
       }
     ]
   }
   ```
5. Choose whether to retrieve all results or limit the number:
   - Toggle "Get All" to true to retrieve all matching records
   - Toggle "Get All" to false and set "Max Records" (1-500) to limit the results
6. Enable **Select Columns** to choose specific fields to return
7. Enable **Add Reference Labels** and **Add Picklist Labels** for human-readable values
8. Execute the workflow to retrieve tickets that are not complete AND either have priority 6 OR are due within the next 3 days

### Advanced Example: Working with Parent-Child Relationships

Many Autotask entities have parent-child relationships (e.g., Companies and Contacts). To work with these:

1. First, retrieve or create the parent entity
2. Use the parent entity's ID in the child entity operations
3. For example, to create a Contact for a Company:
   - First node: Get or create the Company
   - Second node: Create a Contact with the Company ID

### Example: Setting Up a Webhook Trigger

1. Add an **Autotask Trigger** node to your workflow
2. Select the entity type to monitor (Companies, Contacts, Tickets, etc.)
3. Select the events to subscribe to (Create, Update, Delete)
4. Configure the webhook URL (n8n will handle this automatically)
5. Optionally specify fields to include in the webhook payload
6. Optionally exclude specific resources from triggering the workflow
7. Configure email notifications for webhook delivery failures if needed
8. Save and activate the workflow
9. The node will automatically register the webhook with Autotask
10. When events occur in Autotask, they will trigger your workflow
11. When the workflow is deactivated, the webhook will be automatically removed

## Configuration

### Caching Options

The node includes an enhanced file-based caching system to improve performance by reducing API calls:

- **Enable Field Caching**: Toggle caching on/off
- **Cache TTL**: How long to cache field values (in seconds)
- **Cache Entity Info**: Whether to cache entity information and field definitions
- **Entity Info TTL**: How long to cache entity information
- **Cache Reference Fields**: Whether to cache reference field values
- **Reference Fields TTL**: How long to cache reference field values
- **Cache Picklists**: Whether to cache picklist values
- **Picklists TTL**: How long to cache picklist values
- **File-based Cache**: Cache is stored in files that can be shared between workflows and runs
- **Cache Directory**: Optional path to a directory where cache files will be stored

### Label Enrichment

The node provides options to enrich entities with human-readable labels:

- **Add Picklist Labels**: Adds "_label" fields for picklist values (e.g., Status_label: "In Progress")
- **Add Reference Labels**: Adds "_label" fields for reference values (e.g., Company_label: "Acme Corporation")

### Column Selection

To improve performance and reduce payload size, you can select specific columns to return:

- **Select Columns**: Choose which fields to include in the response
- Works with all get operations (get, getMany, getManyAdvanced)
- Compatible with label enrichment features

### Timezone Handling

All dates and times in the Autotask API are in UTC. The node automatically converts between your selected timezone and UTC:

- When creating or updating records, local times are converted to UTC
- When retrieving records, UTC times are converted to your local timezone
- The timezone is configured in the credentials

## Limitations

### API Limits

- Maximum 500 records per page in query results
- Maximum 50 pages per query operation
- Maximum 500 OR conditions in filters
- Maximum 1 User Defined Field per query

### Entity-Specific Limitations

- Some entities may not support all operations (e.g., Project Phases cannot be deleted)
- Parent-child relationships require specific handling
- Some fields may be read-only or have specific validation rules

### Performance Considerations

- Large queries may be slow and should be optimised with filters
- Column selection can significantly improve performance by reducing payload size
- Complex workflows with many API calls may hit rate limits

## Troubleshooting

### Common Issues

- **Authentication Errors**: Verify your API credentials and ensure the API user has appropriate permissions
- **Field Validation Errors**: Check field requirements in the Autotask API documentation
- **Rate Limiting**: If you encounter rate limiting, reduce the frequency of API calls or implement retry logic

### Reporting Bugs

If you encounter any bugs or issues with this integration:

1. Check the [GitHub Issues](https://github.com/msoukhomlinov/n8n-nodes-autotask/issues) to see if the problem has already been reported
2. If not, please submit a new issue with:
   - A clear description of the problem
   - Steps to reproduce the issue
   - Expected vs actual behaviour
   - Your environment details (n8n version, Node.js version)
   - Any relevant error messages or screenshots

Bug reports should be submitted via GitHub at: https://github.com/msoukhomlinov/n8n-nodes-autotask/issues

## Resources

- [Autotask API Documentation](https://ww6.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm)
- [n8n Documentation](https://docs.n8n.io/)
- [GitHub Repository](https://github.com/msoukhomlinov/n8n-nodes-autotask)

## License

[MIT](LICENSE) 
