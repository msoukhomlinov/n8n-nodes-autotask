import type { INodeProperties } from 'n8n-workflow';

export const operationOptions = [
    {
        name: 'Get',
        value: 'get',
        description: 'Get a service level agreement result',
        action: 'Get a service level agreement result',
    },
    {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many service level agreement results',
        action: 'Get many service level agreement results',
    },
    {
        name: 'Count',
        value: 'count',
        description: 'Count service level agreement results',
        action: 'Count service level agreement results',
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
                resource: ['serviceLevelAgreementResult'],
            },
        },
        options: operationOptions,
        default: 'get',
    },
    {
        displayName: 'Service Level Agreement ID',
        name: 'serviceLevelAgreementID',
        type: 'string',
        default: '',
        displayOptions: {
            show: {
                resource: ['serviceLevelAgreementResult'],
                operation: ['get', 'getMany', 'getManyAdvanced', 'count', 'getEntityInfo', 'getFieldInfo'],
            },
        },
        description: 'Optional. When provided, child endpoints are used (/ServiceLevelAgreements/{serviceLevelAgreementID}/Results*). When empty, root endpoints are used (/ServiceLevelAgreementResults*)',
    },
    {
        displayName: 'Service Level Agreement Result ID',
        name: 'id',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
            show: {
                resource: ['serviceLevelAgreementResult'],
                operation: ['get'],
            },
        },
        description: 'The ID of the service level agreement result record',
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
                resource: ['serviceLevelAgreementResult'],
                operation: ['getMany', 'count'],
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
export const serviceLevelAgreementResultFields = baseFields;
