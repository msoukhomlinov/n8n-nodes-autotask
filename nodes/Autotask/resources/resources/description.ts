import type { INodeProperties } from 'n8n-workflow';

export const resourceFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: ['resource'],
      },
    },
    options: [
      {
        name: 'Get',
        value: 'get',
        description: 'Get a resource by ID',
        action: 'Get a resource',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get multiple resources',
        action: 'Get multiple resources',
      },
      {
        name: 'Who Am I',
        value: 'whoAmI',
        description: 'Retrieve the resource details of the API user specified in the node credentials',
        action: 'Get API user resource details',
      },
      {
        name: 'Transfer Ownership',
        value: 'transferOwnership',
        description: 'Transfer ownership and assignments from one resource to another with optional dry run',
        action: 'Transfer ownership',
      },
      {
        name: 'Update',
        value: 'update',
        description: 'Update a resource',
        action: 'Update a resource',
      },
      {
        name: 'Count',
        value: 'count',
        description: 'Count number of resources',
        action: 'Count resources',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'Resource ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['update', 'get'],
      },
    },
  },
  {
    displayName: 'Fields',
    name: 'fieldsToMap',
    type: 'resourceMapper',
    default: {
      mappingMode: 'defineBelow',
      value: null,
    },
    required: true,
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['update', 'getMany', 'count'],
      },
    },
    typeOptions: {
      loadOptionsDependsOn: ['resource', 'operation'],
      resourceMapper: {
        resourceMapperMethod: 'getFields',
        mode: 'add',
        fieldWords: {
          singular: 'field',
          plural: 'fields',
        },
        addAllFields: false,
        multiKeyMatch: true,
        supportAutoMap: true,
      },
    },
  },
  // ── Transfer Ownership: core identifiers ──
  {
    displayName: 'Source Resource Name or ID',
    name: 'sourceResourceId',
    type: 'options',
    required: true,
    default: '',
    description: 'Resource currently assigned to the work. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    typeOptions: {
      loadOptionsMethod: 'getResourceOptions',
    },
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Receiving Resource Name or ID',
    name: 'destinationResourceId',
    type: 'options',
    required: true,
    default: '',
    description: 'Resource receiving the reassigned work. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    typeOptions: {
      loadOptionsMethod: 'getResourceOptions',
    },
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    description: 'Whether to preview planned updates without writing changes',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  // ── Transfer Ownership: include toggles (alphabetical) ──
  {
    displayName: 'Include Appointments',
    name: 'includeAppointments',
    type: 'boolean',
    default: false,
    description: 'Whether to move appointments assigned to the source resource',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Include Companies',
    name: 'includeCompanies',
    type: 'boolean',
    default: false,
    description: 'Whether to transfer company ownership for companies owned by the source resource',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Company ID Allowlist',
    name: 'companyIdAllowlist',
    type: 'string',
    default: '',
    placeholder: '123,456,789',
    description: 'Optional comma-separated company IDs to scope company ownership transfer',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
        includeCompanies: [true],
      },
    },
  },
  {
    displayName: 'Include Opportunities',
    name: 'includeOpportunities',
    type: 'boolean',
    default: false,
    description: 'Whether to transfer opportunities owned by the source resource',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Include Projects',
    name: 'includeProjects',
    type: 'boolean',
    default: false,
    description: 'Whether to reassign projects (lead, tasks, and/or task secondary resources). Use Project Reassign Mode to choose what is reassigned within each project.',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Project Reassign Mode',
    name: 'projectReassignMode',
    type: 'options',
    default: 'leadAndTasks',
    description: 'Controls what is reassigned within discovered projects. Lead = project lead resource. Tasks = tasks assigned to source under those projects. Secondary = task secondary resource assignments under those project tasks.',
    options: [
      { name: 'Lead Only', value: 'leadOnly' },
      { name: 'Lead and Tasks', value: 'leadAndTasks' },
      { name: 'Lead, Tasks, and Task Secondary Resources', value: 'leadTasksAndSecondary' },
      { name: 'Tasks Only', value: 'tasksOnly' },
      { name: 'Tasks and Task Secondary Resources', value: 'tasksAndSecondary' },
    ],
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
        includeProjects: [true],
      },
    },
  },
  {
    displayName: 'Include Service Call Assignments',
    name: 'includeServiceCallAssignments',
    type: 'boolean',
    default: false,
    description: 'Whether to move service call ticket/task resource assignments where the source resource is assigned',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Include Tickets',
    name: 'includeTickets',
    type: 'boolean',
    default: false,
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Ticket Assignment Mode',
    name: 'ticketAssignmentMode',
    type: 'options',
    default: 'primaryOnly',
    options: [
      { name: 'Primary Only', value: 'primaryOnly' },
      { name: 'Primary and Secondary', value: 'primaryAndSecondary' },
    ],
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
        includeTickets: [true],
      },
    },
  },
  // ── Transfer Ownership: filtering options ──
  {
    displayName: 'Due Window',
    name: 'dueWindowPreset',
    type: 'options',
    default: '',
    description: 'Restrict work by due/end date window. Applies to tickets (dueDateTime), tasks (endDateTime), projects (endDateTime), and appointments (endDateTime). Does not affect companies or opportunities.',
    options: [
      { name: 'No Cut-Off', value: '' },
      { name: 'Today', value: 'today' },
      { name: 'Tomorrow', value: 'tomorrow' },
      { name: 'Two Days From Now', value: 'plus2Days' },
      { name: 'Three Days From Now', value: 'plus3Days' },
      { name: 'Four Days From Now', value: 'plus4Days' },
      { name: 'Five Days From Now', value: 'plus5Days' },
      { name: 'Seven Days From Now', value: 'plus7Days' },
      { name: 'Fourteen Days From Now', value: 'plus14Days' },
      { name: 'Thirty Days From Now', value: 'plus30Days' },
      { name: 'Custom', value: 'custom' },
    ],
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Custom Due Before',
    name: 'dueBeforeCustom',
    type: 'string',
    default: '',
    placeholder: 'YYYY-MM-DD or ISO datetime',
    description: 'Custom due cut-off date/time',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
        dueWindowPreset: ['custom'],
      },
    },
  },
  {
    displayName: 'Only Open/Active',
    name: 'onlyOpenActive',
    type: 'boolean',
    default: true,
    description: 'Whether to exclude terminal statuses (closed, complete, done, inactive) by default. Applies to tickets, tasks, projects, and opportunities. Does not affect companies, appointments, or secondary resource assignments.',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Include Items With No Due Date',
    name: 'includeItemsWithNoDueDate',
    type: 'boolean',
    default: true,
    description: 'Whether to include items with no due/end date. Applies to tickets, tasks, projects, and appointments. Defaults to false when a due window is set unless explicitly configured.',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  // ── Transfer Ownership: safety caps ──
  {
    displayName: 'Max Items Per Entity',
    name: 'maxItemsPerEntity',
    type: 'number',
    default: 500,
    typeOptions: {
      minValue: 1,
      numberStepSize: 1,
    },
    description: 'Hard stop per entity type to prevent runaway updates',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Max Companies',
    name: 'maxCompanies',
    type: 'number',
    default: 500,
    typeOptions: {
      minValue: 1,
      numberStepSize: 1,
    },
    description: 'Hard stop for company count to prevent runaway ownership changes',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  // ── Transfer Ownership: status allowlists ──
  {
    displayName: 'Status Allowlist by Label',
    name: 'statusAllowlistByLabel',
    type: 'string',
    default: '',
    placeholder: 'New,In Progress',
    description: 'Optional comma-separated status labels to include. Applies to tickets, tasks, projects, and opportunities. Matched against live picklist values from the Autotask API at runtime — not limited to the placeholder examples.',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Status Allowlist by Value',
    name: 'statusAllowlistByValue',
    type: 'string',
    default: '',
    placeholder: '1,2,3',
    description: 'Optional comma-separated status integer values to include. Applies to tickets, tasks, projects, and opportunities.',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  // ── Transfer Ownership: audit notes ──
  {
    displayName: 'Add Audit Notes',
    name: 'addAuditNotes',
    type: 'boolean',
    default: false,
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Audit Note Template',
    name: 'auditNoteTemplate',
    type: 'string',
    default: 'Ownership transferred from {sourceResourceName} ({sourceResourceId}) to {destinationResourceName} ({destinationResourceId}) on {date}',
    typeOptions: {
      rows: 3,
    },
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
        addAuditNotes: [true],
      },
    },
  },
  // ── Transfer Ownership: impersonation ──
  {
    displayName: 'Impersonation Resource ID',
    name: 'impersonationResourceId',
    type: 'string',
    default: '',
    description: 'Optional resource ID for impersonated write attribution',
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
  },
  {
    displayName: 'Proceed Without Impersonation If Denied',
    name: 'proceedWithoutImpersonationIfDenied',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['resource'],
        operation: ['transferOwnership'],
      },
    },
    description: 'Whether to proceed without impersonation when denied. Only applies when Impersonation Resource ID is set. When on, if the impersonated resource is active but Autotask denies a write due to permissions, the request is retried without impersonation and proceeds as the API user. Default: on.',
  },
];
