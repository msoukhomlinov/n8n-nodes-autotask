# n8n-nodes-autotask

![n8n-nodes-autotask](https://img.shields.io/npm/v/n8n-nodes-autotask?label=n8n-nodes-autotask&color=blue)
![License](https://img.shields.io/badge/license-MIT-green)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow.svg)](https://buymeacoffee.com/msoukhomlinov)

> **IMPORTANT**: After updating this node to a new version, a restart of your n8n instance is highly recommended to ensure all changes are properly applied.

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
[Support](#support)  
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

**Autotask AI Tools node:** To use the Autotask AI Tools node with the AI Agent, set `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` in your n8n environment.

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

**Australia/New Zealand (Sydney) datacentre:** If you are on the AUS/NZ Sydney datacentre, from 11 March 2026 select the zone **Australia / New Zealand (Sydney — from 11 Mar 2026)** (API: webservices29.autotask.net). For that zone, the URLs are: User interface ww29.autotask.net; API webservices29.autotask.net; Data Warehouse reports29.autotask.net; Performance Analytics workbooks workbooks29.autotask.net.

## Features

### Autotask AI Tools

The **Autotask AI Tools** node exposes Autotask operations as individual tools for the AI Agent. Add one node per resource (e.g. ticket, company, contact), select the operations to expose (get, getMany, count, create, createIfNotExists, update, delete; plus whoAmI and transferOwnership for Resource, getPosted/getUnposted for Time Entry, searchByDomain for Company, slaHealthCheck for Ticket, moveConfigurationItem for Configuration Items), and connect to an AI Agent. Each configured resource becomes a single unified tool (`autotask_<resource>`) with an `operation` enum that routes to the correct handler. Available resources and operations are derived from the same entity metadata as the main Autotask node. Requires `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` in your n8n environment.

Key AI Tools capabilities:

- **Name-based label resolution**: The LLM can pass human-readable names for picklist and reference fields (e.g. `resourceID: "Will Spence"` instead of `resourceID: 29683`). Resolution is transparent — successful responses include a `resolvedLabels` array showing each mapping. Ambiguous matches produce `pendingConfirmations` for user confirmation. Works for both write operations and read filter values.
- **Required fields in descriptions**: Create operation descriptions embed a compact required-fields summary with type info, eliminating the `describeFields` prerequisite for most create workflows.
- **OR filter logic**: List operations accept a `filter_logic` parameter (`'and'` or `'or'`) to control how filter pairs are combined.
- **Offset pagination**: List operations accept an `offset` parameter for paginating through results (up to 100 records). Responses include `hasMore` and `nextOffset` for continuation.
- **Impersonation name resolution**: The `impersonationResourceId` parameter accepts a name or email in addition to numeric IDs.
- **Idempotent creation**: `createIfNotExists` operations (see below) provide find-or-create semantics with configurable dedup fields.
- **Automatic response enrichment**: Records that reference a ticket (via `ticketID`) or task (via `taskID`) are automatically enriched with human-readable fields (`ticketNumber`, `ticketTitle`, `taskTitle`, `taskProjectNumber`, `taskProjectName`). Enrichment is transparent — it requires no configuration and applies to all list, get, and compound responses.

### Supported Resources

The node supports the following Autotask resources:

| Resource | Description |
|----------|-------------|
| API Threshold | Check Autotask API usage limits and current usage levels |
| Appointment | Manage appointments (scheduled calendar work assigned to resources) |
| Billing Code | Manage billing codes for time entries and charges |
| Billing Items | Manage Autotask Billing Items, which represent billable items that have been approved and posted for potential invoicing |
| Change Request Link | Manage links between Change Request tickets and Problem/Incident tickets. Includes Create If Not Exists for idempotent link creation. |
| Checklist Library | Manage modular checklist components that can be applied to tickets or tasks |
| Checklist Library Checklist Item | Manage individual checklist items within checklist library templates |
| Classification Icon | Query classification icons used for categorising and visually identifying items |
| Company | Manage organisations in Autotask. Includes Search by Domain (website/domain with optional contact-email fallback). |
| Company Alert | Manage alerts associated with companies |
| Company Location | Manage locations for companies |
| Company Note | Manage notes attached to companies |
| Company Site Configuration | Manage company site configurations and user-defined fields for customer companies |
| Company Webhook | Manage webhooks for company events |
| Configuration Item | Manage configuration items (CIs) for companies. Includes Move Configuration Item for cross-company CI cloning with optional notes and attachments copy. Includes Create If Not Exists for idempotent CI creation scoped by company. |
| Configuration Item Billing Product Association | Manage product associations for configuration items |
| Configuration Item Category | Manage categories for configuration items |
| Configuration Item Category UDF Association | Manage UDF associations for CI categories |
| Configuration Item DNS Record | Manage DNS records for configuration items |
| Configuration Item Note | Manage notes for configuration items |
| Configuration Item Related Item | Manage related items for configuration items |
| Configuration Item SSL Subject Alternative Name | Manage SSL alternative names for configuration items |
| Configuration Item Type | Manage types for configuration items |
| Configuration Item Webhook | Manage webhooks for configuration item events |
| Contact | Manage contacts associated with companies. Includes Move to Company operation for migrating contacts between companies. |
| Contact Groups | Manage contact groups |
| Contact Group Contacts | Manage contacts within contact groups |
| Contact Webhook | Manage webhooks for contact events |
| Contract | Manage contracts for companies. Includes Create If Not Exists for idempotent contract creation scoped by company. |
| Contract Billing Rules | Manage billing rules for contracts |
| Contract Block | Manage block hour contracts |
| Contract Block Hour Factor | Manage hour factors for block hour contracts |
| Contract Charge | Manage charges associated with contracts. Includes Create If Not Exists for idempotent charge creation. |
| Contract Exclusion Billing Codes | Manage excluded billing codes for contracts |
| Contract Exclusion Roles | Manage excluded roles for contracts |
| Contract Exclusion Set Excluded Roles | Manage excluded roles within exclusion sets |
| Contract Exclusion Set Excluded Work Types | Manage excluded work types within exclusion sets |
| Contract Exclusion Sets | Manage reusable sets of excluded roles and work types for contracts |
| Contract Milestone | Manage milestones for contracts |
| Contract Note | Manage notes attached to contracts |
| Contract Rate | Manage rates for contract services |
| Contract Retainers | Manage retainers for contracts |
| Contract Role Costs | Manage role costs for contracts |
| Contract Service | Manage services within contracts. Includes Create If Not Exists for idempotent service assignment. |
| Contract Service Adjustments | Manage adjustments for contract services |
| Contract Service Bundle Adjustments | Manage adjustments for service bundles |
| Contract Service Bundles | Manage service bundles within contracts |
| Contract Service Bundle Units | Manage service bundle units |
| Contract Service Unit | Manage service units for contracts |
| Contract Ticket Purchases | Manage ticket purchases for contracts |
| Countries | Query countries, which are used in address information for companies, contacts, and resources |
| Domain Registrars | Manage domain registrars |
| Holiday | Manage holiday dates |
| Holiday Set | Manage holiday sets for resources |
| Invoices | Manage invoices |
| Notification History | View notification history |
| Opportunity | Manage sales opportunities |
| Product | Manage products in the catalogue |
| Product Vendors | Manage vendor associations for products |
| Project | Manage projects |
| Project Charge | Manage charges associated with projects. Includes Create If Not Exists for idempotent charge creation. |
| Project Note | Manage notes attached to projects |
| Project Phase | Manage phases within projects |
| Project Task | Manage tasks within projects |
| Project Task Secondary Resources | Manage secondary resource assignments on project tasks |
| Quote | Manage quotes for opportunities with pricing for products, services, and labour |
| Quote Item | Manage line items for quotes including products, services, and labour |
| Quote Location | Manage shipping and billing address information for quotes |
| Quote Template | Query quote templates that define content and appearance of quotes |
| Resource | Manage staff resources. Includes Who Am I and Transfer Ownership (companies, opportunities, tickets, tasks, projects, task/secondary and service-call assignments, appointments) with dry run and optional audit notes. |
| Resource Role | Manage department/role relationships, service desk queues, and service desk roles |
| Roles | Manage roles in the system |
| Search Filter | Build advanced search filters |
| Service | Manage services offered to clients |
| Service Call | Manage service calls |
| Service Call Task | Manage tasks associated with service calls |
| Service Call Task Resource | Manage resources assigned to service call tasks |
| Service Call Ticket | Manage tickets linked to service calls |
| Service Call Ticket Resource | Manage resources assigned to service call tickets |
| Service Level Agreement Result | Query SLA results tracking time and completion data for service level events |
| Skill | Query skills used for resource competency tracking |
| Survey | Manage customer surveys |
| Survey Results | Manage results from customer surveys |
| Subscription | Manage Subscriptions, which represent recurring service agreements with customers |
| Subscription Period | Query Subscription Periods, which track billing periods and usage for subscriptions |
| Tag | Manage ticket and article tags with unique label requirements |
| Tag Alias | Manage alternative names for tags to improve searchability |
| Tag Group | Organise tags into categories with display colours and system group protections |
| Ticket | Manage service tickets. Includes SLA Health Check (SLA milestone timing and status), Summary (compact type-aware summary with filtered fields, computed values, child entity counts, and relationships), and Timeline (merged chronological event stream — notes, time entries, optional history — for escalation briefs and effort audits). |
| Ticket Attachment | Manage files attached directly to tickets |
| Ticket Category | Manage ticket categories with display colors and default field values |
| Ticket Category Field Default | Query default field values for ticket categories |
| Ticket Change Request Approval | Manage ticket change request approvals using root and ticket child endpoint scopes |
| Ticket Charge | Manage charges associated with tickets. Includes Create If Not Exists for idempotent charge creation. |
| Ticket Checklist Item | Manage checklist items on tickets |
| Ticket Checklist Library | Add all items from a checklist library to a ticket |
| Ticket History | View historical changes to tickets |
| Ticket Note | Manage notes attached to tickets |
| Ticket Note Attachment | Manage files attached to ticket notes |
| Ticket Note Webhook | Manage webhooks for ticket note events |
| Ticket Secondary Resource | Manage secondary resource assignments on tickets |
| Ticket Webhook | Manage webhooks for ticket events |
| Time Entry | Manage time entries for billing. Includes Get Posted and Get Unposted operations for listing labour entries by posting status with cross-entity filters. Includes Create If Not Exists for idempotent time entry creation scoped by resource. |
| Time Entry Attachment | Manage files attached to time entries |

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
  - Flatten User-Defined Fields for easier access in workflows
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
  - Flatten User-Defined Fields for easier access in workflows
  - Date-based filtering with automatic timezone handling
- **Create If Not Exists**: Idempotent creation — checks for an existing record matching configurable dedup fields before creating. Available for Contract Charge, Ticket Charge, Project Charge, Configuration Item, Time Entry, Contract Service, and Contract. Supports:
  - Configurable dedup fields (choose which fields to match on)
  - `errorOnDuplicate` option to fail instead of silently skipping when a duplicate is found
  - Same dynamic field loading as the Create operation (resourceMapper)
  - Outcomes: `created` (new record), `skipped` (duplicate found), or scope-entity-not-found error
- **Count**: Get the number of matching records
- **Get Entity Info**: Retrieve metadata about the entity
- **Get Field Info**: Retrieve field definitions for the selected entity

For the **Time Entry** resource, additional posting-status operations are available:

- **Get Posted**: List time entries that have been approved and posted as billing items
- **Get Unposted**: List time entries that have not yet been posted

Both operations cross-reference TimeEntries with BillingItems (Autotask has no posted-status field on TimeEntry itself). They support collapsible filters including Date Range (13 presets), Time Entry Type, Billable Status, Hours Worked range, Resource, Contract Type, Ticket Status, Task Status, Queue, and Account Manager. Date range resolution respects the configured credential timezone and converts to UTC for the API.

For the **Company** resource, **Search by Domain** finds companies by website/domain (domain or full URL; operator: eq, contains, beginsWith, endsWith). If no company website matches and the option is enabled (default), it falls back to contact email domain and returns the most common company. Available on both the main Autotask node and the Autotask AI Tools node.

For the **Ticket** resource, **SLA Health Check** accepts either Ticket ID or Ticket Number, then combines Ticket and Service Level Agreement Result data to return first-response, resolution-plan, and resolution health with a consistent unit of hours (2 decimal places). It supports **Add Picklist Labels** and **Add Reference Labels** for enriched output, includes an SLA-only fallback to resolve `companyID_label` when reference labels are enabled, and lets you choose which ticket fields to include in the ticket payload (default: `id`, `ticketNumber`, `title`, `status`, `companyID`). This operation is available in both the main Autotask node and the Autotask AI Tools node (AI parameter: `ticketFields`).

For the **Ticket** resource, **Summary** (`ticket.summary`) produces a compact, type-aware snapshot of any Autotask ticket. It accepts either a ticket `id` or `ticketNumber`. The operation returns four blocks alongside the filtered ticket payload:

- **`summary`** — the ticket fields after null/empty filtering and type-aware field ordering. Universal fields (id, ticketNumber, title, status, priority, companyID) lead; type-specific fields follow based on the detected type (Change Request: change-approval fields and all `changeInfoField*` aliases; Incident: assignment, role, queue, SLA milestones; Problem: assignment, role, queue, SLA milestones; Service Request: assignment, role, queue, due date, estimated hours, SLA milestones; Alert: assignment, queue, due date, first-response milestone, SLA; Unknown: assignment, queue, due date, estimated hours); remaining fields trail in natural order.
- **`computed`** — derived values calculated from the ticket's own fields: `ageHours`, `daysSinceLastActivity`, `isAssigned`. For open tickets: `isOverdue`, plus `hoursUntilDue` (positive, when not yet overdue) or `hoursOverdue` (positive magnitude, when past due). SLA fields when an SLA is assigned: `slaStatus` (`No SLA` / `Met` / `Paused` / `Breached` / `At Risk` / `On Track` / `Pending`), `slaNextMilestoneDueHours` (hours until next upcoming unmet milestone), and `slaEarliestBreachHours` (hours since earliest unmet overdue milestone). SLA milestone status uses the same logic as `ticket.slaHealthCheck` (wall-clock comparison; no business-hours adjustment).
- **`relationships`** — linked entities when present: `linkedProblem` (via `problemTicketId`), `project` (via `projectID`), `opportunity` (via `opportunityID`).
- **`childCounts`** — counts fetched in parallel: `notes`, `timeEntries`, `attachments`, `additionalConfigurationItems`, `additionalContacts`, `checklistItems` (object with `total` / `completed` / `remaining`), and `changeRequestLinks` (Change Request tickets only). Zero-value counts are omitted. Count fetch errors are surfaced in `_meta.countErrors` rather than failing the whole operation. **Omitted by default** — set `includeChildCounts: true` to fetch and include this block.
- **`_meta`** — transformation audit trail describing exactly how the summary was shaped: `detectedTicketType` + `typeDetectedBy` (`'label'` / `'numericField'` / `'fallback'`), `transformationsApplied` (ordered list — e.g. `['aliasExpansion', 'nullFiltering', 'textTruncation', 'typeAwareOrdering']`), `prioritisedFields` (fields placed in the universal or type-specific priority buckets), `excludedFieldCount` + `excludedFieldNames` (fields dropped for being null/empty), `rawIncluded` (boolean), `childCountsIncluded` (boolean — whether child-count enrichment was performed), `truncationApplied` (boolean) + `truncatedFields` detail when active, `countsPartial` (boolean) + `countErrors` detail when any count fetch failed, `aliasesApplied` + `suppressedCanonicalFields` + `aliasMap` when Change Info aliases are active, `slaDetailAvailable`, `source`, `generatedAt`.

Reference label enrichment, picklist label enrichment, and UDF flattening are always applied — no per-operation toggles. Long text fields (`description`, `resolution`) are truncated to `summaryTextLimit` characters (default 500; set to 0 to disable). Set `includeRaw: true` to receive the full enriched payload before filtering, truncation, and alias renaming, with canonical `changeInfoField{N}` keys intact. Set `includeChildCounts: true` to fetch child entity counts (several parallel API calls; omitted by default for speed). Available in both the standard node and AI Tools.

For the **Configuration Item** resource, **Move Configuration Item** clones a CI to another company (Autotask does not allow companyID changes in place), with optional copying of UDFs, CI attachments, notes, and note attachments. Uses API-driven writable field detection so new Autotask fields are handled automatically. Leaves customisable audit notes on both source and destination CIs with deep links and company names, supports dry-run mode, and can deactivate the source CI after completion checks. Optionally set **Impersonation Resource ID** so created records are attributed to a specific resource. Tickets/tasks/projects/contracts and other associations are explicitly not migrated by this operation.

For webhook resources (Company Webhook, Contact Webhook, Configuration Item Webhook, Ticket Webhook, Ticket Note Webhook), the following operations are available:
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

- **Resource Mapping**: Dynamically map fields based on entity definitions. When Mapping Column Mode is set to "Map automatically" (`autoMapInputData`), the node uses incoming item data directly and passes all fields whose keys match the selected entity's schema IDs, regardless of whether those columns are toggled off in the UI. Node parameter mappings are ignored in this mode (matching n8n's standard resource mapper behaviour). `bodyJson` still takes final precedence as an override.
- **Advanced Filtering**: Build complex queries with multiple conditions
- **Column Selection**: Choose specific fields to return in get operations
- **Picklist Label Enrichment**: Automatically add human-readable labels for picklist fields
- **Reference Label Enrichment**: Add human-readable labels for reference fields
- **UDF Flattening**: Bring user-defined fields up to the top level of response objects for easier access
- **File-based Caching**: Improved performance with persistent caching that can be shared between workflows and runs
- **Timezone Handling**: Automatic conversion between local time and UTC
- **API Usage Monitoring**: Check current API usage thresholds and limits using the API Threshold resource to help prevent hitting rate limits and ensure smooth operations
- **Dry Run Mode**: Preview write operations (create, update, delete) without making actual changes. When enabled, returns a preview of the request that would be sent, useful for testing and validation
- **Inactive Entity Handling**: When a create or update is rejected because a reference field (e.g. `contactID`, `createdByPersonID`) points to an inactive contact or resource, the node automatically activates the entity, retries the operation, then deactivates it again. This applies to all entities and requires no configuration

### API Threshold Resource

The API Threshold resource provides a simple way to monitor your Autotask API usage limits and current consumption. This helps users:
- Track how many API requests have been made in the current timeframe
- See the maximum allowed requests (threshold limit)
- View the usage as a percentage and categorized level (Normal, Moderate, High, Critical)
- Calculate remaining available requests
- Monitor timeframe duration for rate limits

This is particularly useful for workflows that make many API calls, allowing you to implement conditional logic based on current usage levels to avoid hitting rate limits and ensure continuous operation.

### AI Agent Playbook

> **Deprecation notice:** The *Tool* resource and *AI Helper* resource within the main Autotask node are deprecated and will be removed in a future release. Use the dedicated **Autotask AI Tools** node (see [Autotask AI Tools](#autotask-ai-tools) above) for all new AI agent integrations. The helper tools (`describeFields`, `listPicklistValues`) are built into the AI Tools node and do not require a separate aiHelper resource.

This node is optimised for AI agents and tool-calling systems with specialised features designed for autonomous operation.

#### Quick Start for AI Agents

The recommended path is the **Autotask AI Tools** node (see the [Autotask AI Tools](#autotask-ai-tools) section above). Add one node per resource, connect each to your AI Agent's `Tools` input, and the agent gets a tool named `autotask_<resource>` with a unified `operation` enum.

**1. Build the request**

The agent calls a tool like this (the LLM emits the JSON; you don't write it manually):

```jsonc
autotask_ticket({
  operation: "create",
  title: "API Integration Issue",
  description: "Customer reporting connection problems",
  priority: "Medium",         // human-readable label — resolved automatically
  status: "New",              // human-readable label — resolved automatically
  companyID: "Tech Solutions" // reference label — resolved automatically
})
```

Labels for picklist and reference fields are resolved to numeric IDs before the API call. Successful responses include `resolvedLabels` showing each mapping. Ambiguous matches produce `pendingConfirmations` for user confirmation rather than guessing.

**2. Inspect when needed**

Every AI Tools node instance also exposes three helper operations automatically:

- `describeFields` — field metadata (types, required, picklist/reference, dependencies)
- `listPicklistValues` — valid values for a picklist field
- `describeOperation` — full documentation for one operation on the tool

The agent will usually only need these on edge cases — most write operations embed a compact required-fields summary directly in their description.

**3. Read the response**

Responses use a flat shape — the top-level key tells you the response type: `records[]` (list), `record{}` (item), `id` + `record{}` (mutation), `matchCount` (count), `outcome` (compound). All responses include a plain-English `summary` field.

**4. Recover from errors**

Error responses include `errorType`, a `summary` prefixed with `REQUIRED NEXT STEP: ...` for actionable cases, and a `nextAction` string telling the agent what to call before retrying (e.g. `listPicklistValues`, `describeFields`).

> **Legacy path:** The main **Autotask** node also exposes a deprecated `aiHelper` resource (`describeResource`, `listPicklistValues`, `validateParameters`) and per-operation flags like `bodyJson`, `selectColumnsJson`, `dryRun`, `outputMode`. These remain in place for existing workflows but should not be used for new AI agent integrations — use the AI Tools node instead.

#### Tool Configuration for Maximum Effectiveness

For optimal AI agent integration, add **one Autotask AI Tools node per resource** to your workflow and connect each one to the AI Agent's `Tools` input. Every instance becomes a single unified tool named `autotask_<resource>` (e.g. `autotask_contact`, `autotask_company`) with an `operation` enum the LLM selects at call time.

**How to add a tool (n8n UI):**

1. Drag an **Autotask AI Tools** node onto the canvas.
2. Connect its `Tools` output to the `Tools` input of your AI Agent node.
3. Configure the node:
   - **Resource Name or ID** — pick one resource (e.g. `contact`).
   - **Operations Names or IDs** — multi-select the operations you want the agent to use (e.g. `get`, `getMany`, `count`). Helper operations `describeFields`, `listPicklistValues`, and `describeOperation` are always included automatically — no need to expose them as a separate inspector tool.
   - **Allow Write Operations** — toggle on to expose `create`, `createIfNotExists`, `update`, `delete`, and resource-specific mutations. Default is off (read-only).
   - **Tool Description Appendix** — optional free-text appended to the tool description, visible to the LLM. Use this for deployment-specific guardrails (e.g. *"Only query tickets in the MSP support queue. Never create tickets for internal IT."*).
   - **Time Entry Notes Guidance** — appears only when Resource = Time Entry. Use it to enforce your house style for Summary Notes and Internal Notes.
4. Repeat for each resource you want the agent to access. Common starting set:

| Node instance | Resource | Typical operations | Write enabled |
|---|---|---|---|
| Companies | `company` | `get`, `getMany`, `count`, `searchByDomain` | usually off |
| Contacts | `contact` | `get`, `getMany`, `create`, `update` | as needed |
| Tickets | `ticket` | `get`, `getMany`, `count`, `create`, `update`, `slaHealthCheck`, `summary` | as needed |
| Time entries | `timeEntry` | `getPosted`, `getUnposted`, `create`, `createIfNotExists` | as needed |
| Resources (MSP staff) | `resource` | `getMany`, `whoAmI` | off |

**Benefits of one-node-per-resource:**
- **Focused schemas** — the LLM sees a tight, predictable set of operations per tool.
- **Granular write control** — enable writes on `contact` without enabling them on `ticket`.
- **Per-resource deployment context** — different appendix guidance for each resource.
- **Cleaner execution view** — each tool call is labelled by resource in n8n's log.

**Label resolution is automatic.** When the LLM passes a human-readable name to a picklist or reference field (e.g. `resourceID: "Will Spence"` or `status: "New"`), it's resolved to the numeric ID before the API call. Ambiguous matches return `pendingConfirmations` rather than guessing. No pre-configuration needed.

#### Environment Setup

For AI tool usage, set this environment variable:

```bash
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

Configuration options:
- Add to your `.env` file
- Set in system environment variables  
- Include in Docker/container configuration
- Add to startup command: `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true n8n start`

#### Example Agent Workflow

**Scenario: Create a contact at an existing company**

This is illustrative — the LLM picks the tool name and `operation` value, and supplies arguments matching each tool's auto-generated Zod schema. You don't write any of this code; it shows what the agent sees and does at runtime.

```jsonc
// Assumes the workflow has two AI Tools node instances configured:
//   - Resource = company  →  exposed as tool  autotask_company
//   - Resource = contact  →  exposed as tool  autotask_contact  (Allow Write Operations = on)

// 1. Find the company by name. Helper operation describeFields is always available
//    if the agent needs to inspect the schema first — usually it doesn't, because
//    required-field summaries are embedded in each create operation's description.
autotask_company({
  operation: "getMany",
  filter_field: "companyName",
  filter_op: "contains",
  filter_value: "Tech Solutions"
})
// → { records: [{ id: 12345, companyName: "Tech Solutions Ltd", ... }], summary: "..." }

// 2. Create the contact. Picklist and reference fields accept human-readable labels;
//    they are resolved to numeric IDs automatically.
autotask_contact({
  operation: "create",
  firstName: "John",
  lastName: "Smith",
  emailAddress: "john.smith@techsolutions.com",
  companyID: 12345,            // numeric ID returned in step 1
  title: "IT Manager"
})
// → { id: 67890, record: { ... }, resolvedLabels: [], summary: "Created contact 67890" }

// 3. If the LLM had passed companyID: "Tech Solutions Ltd" instead of 12345, the
//    response would include resolvedLabels showing the name→ID mapping. Ambiguous
//    names produce pendingConfirmations rather than guessing.
```

**Auto-included helper operations** (no configuration required, available on every AI Tools node instance):

- `describeFields` — return field metadata for the resource (types, required, picklist/reference)
- `listPicklistValues` — return valid values for a picklist field
- `describeOperation` — return full documentation for a specific operation on the tool

#### Error Self-Healing

Errors return a flat JSON shape with structured fields the agent can act on directly:

```jsonc
{
  "error": true,
  "errorType": "INVALID_PICKLIST_VALUE",
  "resource": "ticket",
  "operation": "create",
  "summary": "REQUIRED NEXT STEP: Call autotask_ticket with operation 'listPicklistValues' for field 'priority', then retry — Field 'priority' rejected value 'Urgent'",
  "nextAction": "Call autotask_ticket with operation 'listPicklistValues' for field 'priority', then retry",
  "mustRetryAfter": ["listPicklistValues"],
  "invalidField": "priority",
  "invalidValue": "Urgent"
}
```

Key fields:
- `errorType` — stable string constant (e.g. `INVALID_PICKLIST_VALUE`, `ENTITY_NOT_FOUND`, `MISSING_REQUIRED_FIELDS`, `WRITE_OPERATION_BLOCKED`). Use this to branch in agent prompts or downstream logic.
- `summary` — human-readable. Actionable errors are prefixed with `"REQUIRED NEXT STEP: ..."` so the recovery step is visible in the instruction register, not just buried in context.
- `nextAction` — exact recovery step in plain English. References the unified tool name (e.g. `autotask_ticket with operation 'listPicklistValues'`).
- `mustRetryAfter` — optional list of operations the agent must call before retrying. Surfaced by `formatFieldError`, `formatRequiredFieldsError`, `formatNotFoundError`, and picklist-related failures.
- Context fields (`invalidField`, `filtersUsed`, `missingFields`, `pendingConfirmations`, etc.) appear at the **root** of the response — no `context` wrapper.

#### Best Practices for Agents

- **One node per resource** — gives the agent named, focused tools (`autotask_company`, `autotask_ticket`, etc.) with predictable schemas.
- **Read-only by default** — leave **Allow Write Operations** off unless the agent genuinely needs to mutate data. Enable per-resource, not globally.
- **Use the appendix for guardrails** — put deployment-specific constraints in **Tool Description Appendix** so they're visible to the LLM on every call.
- **Trust label resolution** — let the LLM pass names like `"Will Spence"` or `"In Progress"`. Resolution is automatic, transparent (`resolvedLabels` in the response), and refuses to guess on ambiguous matches.
- **Follow error `nextAction`** — error responses include a `nextAction` string the agent should execute before retrying (e.g. *call `describeFields`*, *call `listPicklistValues`*). Actionable error types prefix the summary with `"REQUIRED NEXT STEP: ..."`.
- **Use `count` for sanity checks** — when listing tickets/charges/etc., call `count` first if the agent only needs a total. Cheaper than `getMany`.
- **Use `createIfNotExists`** for idempotent operations — supported on charges, configuration items, contracts, contract services, change request links, and time entries. Configurable `dedupFields` decide what counts as a duplicate.

#### Troubleshooting

**Tool Not Available:** Ensure `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` is set in your n8n environment.
**Agent doesn't see a write operation:** Toggle **Allow Write Operations** on the corresponding AI Tools node, then save and re-execute.
**LLM passes the wrong picklist value:** The response will include `pendingConfirmations` for ambiguous labels. The agent should surface the candidates to the user or call `listPicklistValues` to disambiguate.
**Large responses overflowing the agent's context:** Reduce `limit`, narrow with `filter_field`/`filter_op`/`filter_value`, or use `count` first to gauge result size before fetching.

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
9. Enable **Flatten User-Defined Fields** to bring UDFs to the top level of response objects
10. Execute the workflow to get tickets with only the selected fields and human-readable labels

### Advanced Example: Complex Filtering with Get Many Advanced

1. Add an **Autotask** node to your workflow
2. Select **Ticket** as the resource
3. Select **Get Many Advanced** as the operation
4. Build a complex filter, for example:
   ```json
   {
      "filter": [
      {
        "op": "and",
        "items": [
          {
            "field": "status",
            "op": "noteq",
            "value": 5
          },
          {
            "op": "or",
            "items": [
              {
                "field": "priority",
                "op": "eq",
                "value": 6
              },
              {
                "field": "dueDateTime",
                "op": "lt",
                "value": "{{ $now.plus(3, 'days').toLocal()}}"
              }
             ]
           }
         ]
      }
    ]
   }
   ```
   [Valid filter operators and filter documentation can be found here](https://ww15.autotask.net/help/DeveloperHelp/Content/APIs/REST/API_Calls/REST_Basic_Query_Calls.htm?Highlight=filter#List2)
5. Choose whether to retrieve all results or limit the number:
   - Toggle "Get All" to true to retrieve all matching records
   - Toggle "Get All" to false and set "Max Records" (1-500) to limit the results
6. Enable **Select Columns** to choose specific fields to return
7. Enable **Add Reference Labels** and **Add Picklist Labels** for human-readable values
8. Execute the workflow to retrieve tickets that are not complete AND either have priority 6 OR are due within the next 3 days

### Example: Monitoring API Usage with API Threshold

1. Add an **Autotask** node to your workflow
2. Select **API Threshold** as the resource
3. The operation **Get API Usage** will be automatically selected (it's the only available operation)
4. Execute the node to receive current API usage information including:
   - Current usage count
   - Maximum threshold (limit)
   - Usage percentage
   - Usage level (Normal, Moderate, High, Critical)
   - Remaining requests
   - Timeframe duration
5. You can use this information with IF nodes to implement conditional logic:
   - Pause workflows when usage is too high
   - Throttle requests during peak usage periods
   - Log warnings when approaching limits
   - Only execute non-critical operations when usage is below certain thresholds

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

> **IMPORTANT**: This node uses dynamic picklists and field enrichers to convert numerical values into human-readable labels through dynamic lookups. It's strongly recommended to keep caching enabled to avoid excessive API calls. Without caching, each picklist and reference field lookup requires separate API calls, which can quickly consume your API rate limits, especially in workflows with many operations or large data sets.

### Change Info Field Aliases

Autotask exposes five tenant-defined text fields on the Ticket entity (`changeInfoField1`..`changeInfoField5`) used on Change Request tickets to capture sections such as business impact, change steps, implementation plan, rollback plan, and risks. The labels for these fields are configured per-tenant in the Autotask UI.

To make these fields easier to work with in workflows and AI agents, the credential supports optional alias enrichment:

- **Enrich Ticket Output with Change Info Field Aliases**: When enabled, all Ticket read operations (`get`, `getMany`, `getManyAdvanced`, `slaHealthCheck`, `summary`) append alias-named copies of these fields alongside the originals.
- **Change Info Field 1–5 Alias**: Alias names appended as `changeInfoField{N}_{alias}` (e.g. `changeInfoField1_issueBusinessImpact`). Defaults: `issueBusinessImpact`, `changesToBeMade`, `implementationPlan`, `reversionPlan`, `risksInvolved`.

Original `changeInfoField1..5` fields are always preserved. Aliases are normalised to safe property-name tokens; blank aliases fall back to `field1`..`field5`; duplicate tokens are suffixed deterministically.

### Label Enrichment and Field Processing

The node provides options to enrich entities with human-readable labels and simplify field access:

- **Add Picklist Labels**: Adds "_label" fields for picklist values (e.g., Status_label: "In Progress")
- **Add Reference Labels**: Adds "_label" fields for reference values (e.g., Company_label: "Acme Corporation")
- **Flatten User-Defined Fields**: When enabled, brings UDFs up to the top level of each response object for easier access instead of being nested in the userDefinedFields array (maintains the original array for backward compatibility)

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
- For Search Filter operations, input dates are thoroughly converted to UTC using the configured timezone, ensuring consistency with API requirements
- Output dates from all operations are converted to the configured local timezone for easier workflow handling

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
- Disabling caching when using picklist or reference label enrichment can lead to a high volume of API calls, potentially triggering rate limits. Each field being enriched requires a separate API call when cache is not available.

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

## Support

If you find this node helpful and want to support its ongoing development, you can buy me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow.svg)](https://buymeacoffee.com/msoukhomlinov)

Your support helps maintain this project and develop new features.

## License

[MIT](LICENSE)
