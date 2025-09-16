import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
  {
    name: 'Create',
    value: 'create',
    description: 'Create a contract exclusion set',
    action: 'Create a contract exclusion set',
  },
  {
    name: 'Update',
    value: 'update',
    description: 'Update a contract exclusion set',
    action: 'Update a contract exclusion set',
  },
  {
    name: 'Get',
    value: 'get',
    description: 'Get a contract exclusion set by ID',
    action: 'Get a contract exclusion set',
  },
  {
    name: 'Get Many',
    value: 'getMany',
    description: 'Get multiple contract exclusion sets',
    action: 'Get multiple contract exclusion sets',
  },
  {
    name: 'Delete',
    value: 'delete',
    description: 'Delete a contract exclusion set',
    action: 'Delete a contract exclusion set',
  },
  {
    name: 'Count',
    value: 'count',
    description: 'Count contract exclusion sets',
    action: 'Count contract exclusion sets',
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
        resource: ['contractExclusionSets'],
      },
    },
    options: operationOptions,
    default: 'get',
  },
  {
    displayName: 'Contract Exclusion Set ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['contractExclusionSets'],
        operation: ['update', 'get', 'delete'],
      },
    },
    description: 'The ID of the contract exclusion set to operate on',
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
        resource: ['contractExclusionSets'],
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

export const contractExclusionSetsFields = baseFields;
