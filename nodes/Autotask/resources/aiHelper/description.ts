import type { INodeProperties } from 'n8n-workflow';

export const aiHelperFields: INodeProperties[] = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
            },
        },
        options: [
            {
                name: 'Describe Resource',
                value: 'describeResource',
                description: 'Get field metadata and schema information for a resource',
                action: 'Describe resource fields and schema',
            },
            {
                name: 'List Picklist Values',
                value: 'listPicklistValues',
                description: 'Get picklist values for a specific field with search and pagination',
                action: 'List picklist values for a field',
            },
            {
                name: 'Validate Parameters',
                value: 'validateParameters',
                description: 'Validate field values without making API calls - pre-flight validation',
                action: 'Validate parameters for create update operations',
            },
        ],
        default: 'describeResource',
    },
    // describeResource operation parameters
    {
        displayName: 'Resource Name or ID',
        name: 'targetResource',
        type: 'options',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['describeResource'],
            },
        },
        typeOptions: {
            loadOptionsMethod: 'getQueryableEntities',
        },
        default: '',
        description: 'The resource to describe. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    },
    {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['describeResource'],
            },
        },
        options: [
            {
                name: 'Read',
                value: 'read',
                description: 'Get fields available for read operations (get, getMany, search)',
            },
            {
                name: 'Write',
                value: 'write',
                description: 'Get fields available for write operations (create, update)',
            },
        ],
        default: 'read',
        description: 'Whether to describe fields for read or write operations',
    },
    // listPicklistValues operation parameters
    {
        displayName: 'Resource Name or ID',
        name: 'targetResource',
        type: 'options',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['listPicklistValues'],
            },
        },
        typeOptions: {
            loadOptionsMethod: 'getQueryableEntities',
        },
        default: '',
        description: 'The resource containing the field. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    },
    {
        displayName: 'Field ID',
        name: 'fieldId',
        type: 'string',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['listPicklistValues'],
            },
        },
        default: '',
        description: 'The field ID to get picklist values for. Use describeResource first to find field IDs.',
        placeholder: 'e.g., status, priority, companyID',
    },
    {
        displayName: 'Search Query',
        name: 'query',
        type: 'string',
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['listPicklistValues'],
            },
        },
        default: '',
        description: 'Optional search term to filter picklist values',
        placeholder: 'Search term...',
    },
    {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['listPicklistValues'],
            },
        },
        default: 50,
        description: 'Max number of results to return',
        typeOptions: {
            minValue: 1,

        },
    },
    {
        displayName: 'Page',
        name: 'page',
        type: 'number',
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['listPicklistValues'],
            },
        },
        default: 1,
        description: 'Page number for pagination (1-based)',
        typeOptions: {
            minValue: 1,
        },
    },
    // validateParameters operation parameters
    {
        displayName: 'Resource Name or ID',
        name: 'targetResource',
        type: 'options',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['validateParameters'],
            },
        },
        typeOptions: {
            loadOptionsMethod: 'getQueryableEntities',
        },
        default: '',
        description: 'The resource type to validate parameters for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    },
    {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['validateParameters'],
            },
        },
        options: [
            {
                name: 'Create',
                value: 'create',
                description: 'Validate parameters for creating a new record',
            },
            {
                name: 'Update',
                value: 'update',
                description: 'Validate parameters for updating an existing record',
            },
        ],
        default: 'create',
        description: 'Operation mode to validate for (affects required field validation)',
    },
    {
        displayName: 'Field Values (JSON)',
        name: 'fieldValues',
        type: 'json',
        required: true,
        displayOptions: {
            show: {
                resource: ['aiHelper'],
                operation: ['validateParameters'],
            },
        },
        default: '{}',
        description: 'JSON object with field IDs as keys and values to validate. Use the same format as bodyJson parameter.',
        placeholder: '{\n  "title": "Test Ticket",\n  "priority": "Medium",\n  "companyID": 12345\n}',
        hint: 'Provide the field values you want to validate. This uses the same format as the bodyJson parameter in create/update operations.',
    },
];
