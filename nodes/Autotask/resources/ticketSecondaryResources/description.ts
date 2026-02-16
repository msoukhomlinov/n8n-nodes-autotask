import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
    {
        name: 'Create',
        value: 'create',
        description: 'Create a ticket secondary resource',
        action: 'Create a ticket secondary resource',
    },
    {
        name: 'Delete',
        value: 'delete',
        description: 'Delete a ticket secondary resource',
        action: 'Delete a ticket secondary resource',
    },
    {
        name: 'Get',
        value: 'get',
        description: 'Get a ticket secondary resource',
        action: 'Get a ticket secondary resource',
    },
    {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many ticket secondary resources',
        action: 'Get many ticket secondary resources',
    },
    {
        name: 'Count',
        value: 'count',
        description: 'Count ticket secondary resources',
        action: 'Count ticket secondary resources',
    },
];

export const baseFields: INodeProperties[] = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
            show: {
                resource: ['ticketSecondaryResource'],
            },
        },
        options: operationOptions,
        default: 'get',
    },
    {
        displayName: 'Ticket Secondary Resource ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['ticketSecondaryResource'],
                operation: ['get', 'delete'],
            },
        },
        description: 'The ID of the ticket secondary resource record',
    },
    {
        displayName: 'Ticket ID',
        name: 'ticketID',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['ticketSecondaryResource'],
                operation: ['create', 'delete'],
            },
        },
        description: 'The ID of the ticket this secondary resource belongs to',
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
                resource: ['ticketSecondaryResource'],
                operation: ['create', 'getMany', 'count'],
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

// Export baseFields directly - addOperationsToResource will be applied in Autotask.node.ts
export const ticketSecondaryResourceFields = baseFields;
