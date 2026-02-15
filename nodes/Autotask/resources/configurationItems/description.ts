import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
  {
    name: 'Create',
    value: 'create',
    description: 'Create a configuration item',
    action: 'Create a configuration item',
  },
  {
    name: 'Update',
    value: 'update',
    description: 'Update a configuration item',
    action: 'Update a configuration item',
  },
  {
    name: 'Get',
    value: 'get',
    description: 'Get a configuration item by ID',
    action: 'Get a configuration item',
  },
  {
    name: 'Get Many',
    value: 'getMany',
    description: 'Get multiple configuration items using field filters',
    action: 'Get multiple configuration items',
  },
  {
    name: 'Count',
    value: 'count',
    description: 'Count number of configuration items',
    action: 'Count configuration items',
  },
  {
    name: 'Move Configuration Item',
    value: 'moveConfigurationItem',
    description: 'Clone a configuration item to another company with optional notes and attachments copy',
    action: 'Move a configuration item to another company',
  },
];

const baseFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: [
          'configurationItems',
        ],
      },
    },
    options: operationOptions,
    default: 'get',
  },
  {
    displayName: 'Configuration Item ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['update', 'get'],
      },
    },
    description: 'The ID of the configuration item to operate on',
  },
  {
    displayName: 'Source Configuration Item ID',
    name: 'sourceConfigurationItemId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'The source configuration item ID to clone',
  },
  {
    displayName: 'Destination Company ID',
    name: 'destinationCompanyId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'The destination company ID for the new configuration item',
  },
  {
    displayName: 'Destination Company Location ID',
    name: 'destinationCompanyLocationId',
    type: 'string',
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Optional destination company location ID. Leave blank to clear location.',
  },
  {
    displayName: 'Destination Contact ID',
    name: 'destinationContactId',
    type: 'string',
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Optional destination contact ID. Leave blank to clear contact linkage.',
  },
  {
    displayName: 'Copy UDFs',
    name: 'copyUdfs',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to copy user-defined fields from source to destination',
  },
  {
    displayName: 'Copy Attachments',
    name: 'copyAttachments',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to copy configuration item attachments',
  },
  {
    displayName: 'Copy Notes',
    name: 'copyNotes',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to copy all configuration item notes',
  },
  {
    displayName: 'Copy Note Attachments',
    name: 'copyNoteAttachments',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
        copyNotes: [true],
      },
    },
    description: 'Whether to copy attachments on copied notes',
  },
  {
    displayName: 'Deactivate Source',
    name: 'deactivateSource',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to deactivate the source configuration item after successful completion checks',
  },
  {
    displayName: 'Source Audit Note',
    name: 'sourceAuditNote',
    type: 'string',
    typeOptions: { rows: 3 },
    default: 'This configuration item was moved to {destinationCompanyName} ({destinationCompanyId}) on {date}.\n\nNew CI: {newConfigurationItemId}\nLink: {newConfigurationItemLink}\n\nRun ID: {runId}',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Audit note left on the source CI. Placeholders: {sourceConfigurationItemId}, {newConfigurationItemId}, {sourceCompanyId}, {sourceCompanyName}, {destinationCompanyId}, {destinationCompanyName}, {sourceConfigurationItemLink}, {newConfigurationItemLink}, {runId}, {date}. Leave blank to skip.',
  },
  {
    displayName: 'Destination Audit Note',
    name: 'destinationAuditNote',
    type: 'string',
    typeOptions: { rows: 3 },
    default: 'This configuration item was copied from {sourceCompanyName} ({sourceCompanyId}) on {date}.\n\nOriginal CI: {sourceConfigurationItemId}\nLink: {sourceConfigurationItemLink}\n\nRun ID: {runId}',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Audit note left on the destination CI. Placeholders: {sourceConfigurationItemId}, {newConfigurationItemId}, {sourceCompanyId}, {sourceCompanyName}, {destinationCompanyId}, {destinationCompanyName}, {sourceConfigurationItemLink}, {newConfigurationItemLink}, {runId}, {date}. Leave blank to skip.',
  },
  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to return a migration plan without creating or updating records',
  },
  {
    displayName: 'Idempotency Key',
    name: 'idempotencyKey',
    type: 'string',
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Optional idempotency key to include in audit notes and output for traceability',
  },
  {
    displayName: 'Impersonation Resource ID',
    name: 'impersonationResourceId',
    type: 'string',
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Optional resource ID to impersonate. Created records (CI, notes, attachments) will be attributed to this resource. Leave blank to use the credential user.',
  },
  {
    displayName: 'Proceed Without Impersonation If Denied',
    name: 'proceedWithoutImpersonationIfDenied',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to proceed without impersonation when denied. Only applies when Impersonation Resource ID is set. When on, if the impersonated resource is active but Autotask denies a write due to permissions, the request is retried without impersonation and proceeds as the API user. Default: on.',
  },
  {
    displayName: 'Masked UDF Policy',
    name: 'includeMaskedUdfsPolicy',
    type: 'options',
    options: [
      { name: 'Omit', value: 'omit' },
      { name: 'Fail', value: 'fail' },
    ],
    default: 'omit',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'How to handle masked UDF values in source data',
  },
  {
    displayName: 'Attachment Oversize Policy',
    name: 'attachmentOversizePolicy',
    type: 'options',
    options: [
      { name: 'Skip + Note', value: 'skip+note' },
      { name: 'Fail', value: 'fail' },
    ],
    default: 'skip+note',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'How to handle attachments above the configured single-file limit',
  },
  {
    displayName: 'Partial Failure Strategy',
    name: 'partialFailureStrategy',
    type: 'options',
    options: [
      { name: 'Deactivate Destination', value: 'deactivateDestination' },
      { name: 'Leave Active With Note', value: 'leaveActiveWithNote' },
    ],
    default: 'deactivateDestination',
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'How to handle partial failures after destination CI creation',
  },
  {
    displayName: 'Max Retries',
    name: 'retryMaxRetries',
    type: 'number',
    default: 3,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Maximum retries for transient attachment copy failures',
  },
  {
    displayName: 'Retry Base Delay Milliseconds',
    name: 'retryBaseDelayMs',
    type: 'number',
    default: 500,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Base delay in milliseconds for retry backoff',
  },
  {
    displayName: 'Retry Jitter',
    name: 'retryJitter',
    type: 'boolean',
    default: true,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Whether to apply jitter to retry delays',
  },
  {
    displayName: 'Max Bytes Per 5 Minutes',
    name: 'throttleMaxBytesPer5Min',
    type: 'number',
    default: 10000000,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Rolling upload throughput limit in bytes per five minutes',
  },
  {
    displayName: 'Max Single File Bytes',
    name: 'throttleMaxSingleFileBytes',
    type: 'number',
    default: 6291456,
    displayOptions: {
      show: {
        resource: ['configurationItems'],
        operation: ['moveConfigurationItem'],
      },
    },
    description: 'Maximum single attachment size in bytes',
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
        resource: ['configurationItems'],
        operation: ['create', 'update', 'getMany', 'count'],
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
];

export const configurationItemFields = baseFields;
