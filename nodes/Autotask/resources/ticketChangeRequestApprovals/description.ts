import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
    {
        name: 'Create',
        value: 'create',
        description: 'Create a ticket change request approval',
        action: 'Create a ticket change request approval',
    },
    {
        name: 'Delete',
        value: 'delete',
        description: 'Delete a ticket change request approval',
        action: 'Delete a ticket change request approval',
    },
    {
        name: 'Get',
        value: 'get',
        description: 'Get a ticket change request approval',
        action: 'Get a ticket change request approval',
    },
    {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many ticket change request approvals',
        action: 'Get many ticket change request approvals',
    },
    {
        name: 'Count',
        value: 'count',
        description: 'Count ticket change request approvals',
        action: 'Count ticket change request approvals',
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
                resource: ['ticketChangeRequestApproval'],
            },
        },
        options: operationOptions,
        default: 'get',
    },
    {
        displayName: 'Ticket Change Request Approval ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['ticketChangeRequestApproval'],
                operation: ['get', 'delete'],
            },
        },
        description: 'The ID of the ticket change request approval record',
    },
    {
        displayName: 'Ticket ID',
        name: 'ticketID',
        type: 'string',
        default: '',
        displayOptions: {
            show: {
                resource: ['ticketChangeRequestApproval'],
                operation: ['create', 'delete'],
            },
        },
        description: 'Required for create and delete operations',
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
                resource: ['ticketChangeRequestApproval'],
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
export const ticketChangeRequestApprovalFields = baseFields;
