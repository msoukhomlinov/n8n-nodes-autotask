import type { INodeProperties } from 'n8n-workflow';

export const ticketFields: INodeProperties[] = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
            show: {
                resource: ['ticket'],
            },
        },
        options: [
            {
                name: 'Create',
                value: 'create',
                description: 'Create a ticket',
                action: 'Create a ticket',
            },
            {
                name: 'Get',
                value: 'get',
                description: 'Get a ticket by ID',
                action: 'Get a ticket',
            },
            {
                name: 'Get Many',
                value: 'getMany',
                description: 'Get many tickets',
                action: 'Get many tickets',
            },
            {
                name: 'SLA Health Check',
                value: 'slaHealthCheck',
                description: 'Get SLA milestone timing and health status for a ticket',
                action: 'Run SLA health check for a ticket',
            },
            {
                name: 'Summary',
                value: 'summary',
                description: 'Get a compact, type-aware summary of a ticket with child entity counts',
                action: 'Get ticket summary',
            },
            {
                name: 'Update',
                value: 'update',
                description: 'Update a ticket',
                action: 'Update a ticket',
            },
            {
                name: 'Count',
                value: 'count',
                description: 'Count tickets',
                action: 'Count tickets',
            },
        ],
        default: 'get',
    },
    {
        displayName: 'Ticket Identifier Type',
        name: 'ticketIdentifierType',
        type: 'options',
        options: [
            {
                name: 'Ticket ID',
                value: 'id',
            },
            {
                name: 'Ticket Number',
                value: 'ticketNumber',
            },
        ],
        default: 'id',
        displayOptions: {
            show: {
                resource: ['ticket'],
                operation: ['slaHealthCheck', 'summary'],
            },
        },
        description: 'How to identify the ticket for SLA health checks or summary',
    },
    {
        displayName: 'Ticket ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['ticket'],
                operation: ['update', 'get'],
            },
        },
        description: 'The ID of the ticket to operate on',
    },
    {
        displayName: 'Ticket ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['ticket'],
                operation: ['slaHealthCheck', 'summary'],
                ticketIdentifierType: ['id'],
            },
        },
        description: 'The ID of the ticket to check',
    },
    {
        displayName: 'Ticket Number',
        name: 'ticketNumber',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'T20240615.0674',
        displayOptions: {
            show: {
                resource: ['ticket'],
                operation: ['slaHealthCheck', 'summary'],
                ticketIdentifierType: ['ticketNumber'],
            },
        },
        description: 'The ticket number to check, for example T20240615.0674',
    },
    {
        displayName: 'Ticket Field Names or IDs',
        name: 'slaTicketFields',
        type: 'multiOptions',
        default: ['id', 'ticketNumber', 'title', 'status', 'companyID'],
        description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        hint: 'Companion label fields (for example status_label) are included automatically when available.',
        displayOptions: {
            show: {
                resource: ['ticket'],
                operation: ['slaHealthCheck'],
            },
        },
        typeOptions: {
            loadOptionsMethod: 'getSelectColumns',
            loadOptionsDependsOn: ['resource', 'operation'],
            showOnlySelected: true,
            searchable: true,
        },
    },
    {
        displayName: 'Include Raw Ticket',
        name: 'includeRaw',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['ticket'], operation: ['summary'] } },
        description: 'Whether to include the full unfiltered ticket payload in the response',
    },
    {
        displayName: 'Summary Text Limit',
        name: 'summaryTextLimit',
        type: 'number',
        default: 500,
        displayOptions: { show: { resource: ['ticket'], operation: ['summary'] } },
        description: 'Maximum characters for description and resolution fields (0 = no limit)',
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
                resource: ['ticket'],
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
