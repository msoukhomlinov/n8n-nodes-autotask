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
