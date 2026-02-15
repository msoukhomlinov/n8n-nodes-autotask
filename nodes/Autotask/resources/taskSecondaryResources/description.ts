import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
    {
        name: 'Create',
        value: 'create',
        description: 'Create a project task secondary resource',
        action: 'Create a project task secondary resource',
    },
    {
        name: 'Delete',
        value: 'delete',
        description: 'Delete a project task secondary resource',
        action: 'Delete a project task secondary resource',
    },
    {
        name: 'Get',
        value: 'get',
        description: 'Get a project task secondary resource',
        action: 'Get a project task secondary resource',
    },
    {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many project task secondary resources',
        action: 'Get many project task secondary resources',
    },
    {
        name: 'Count',
        value: 'count',
        description: 'Count project task secondary resources',
        action: 'Count project task secondary resources',
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
                resource: ['taskSecondaryResource'],
            },
        },
        options: operationOptions,
        default: 'get',
    },
    {
        displayName: 'Project Task Secondary Resource ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['taskSecondaryResource'],
                operation: ['get', 'delete'],
            },
        },
        description: 'The ID of the project task secondary resource record',
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
                resource: ['taskSecondaryResource'],
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
export const taskSecondaryResourceFields = baseFields;
