import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
  {
    name: 'Create',
    value: 'create',
    description: 'Create a configuration item category',
    action: 'Create a configuration item category',
  },
  {
    name: 'Update',
    value: 'update',
    description: 'Update a configuration item category',
    action: 'Update a configuration item category',
  },
  {
    name: 'Get',
    value: 'get',
    description: 'Get a configuration item category by ID',
    action: 'Get a configuration item category',
  },
  {
    name: 'Get Many',
    value: 'getMany',
    description: 'Get multiple configuration item categories using field filters',
    action: 'Get multiple configuration item categories',
  },
  {
    name: 'Count',
    value: 'count',
    description: 'Count number of configuration item categories',
    action: 'Count configuration item categories',
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
          'configurationItemCategories',
        ],
      },
    },
    options: operationOptions,
    default: 'get',
  },
  {
    displayName: 'Configuration Item Category ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItemCategories'],
        operation: ['update', 'get'],
      },
    },
    description: 'The ID of the configuration item category to operate on',
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
        resource: ['configurationItemCategories'],
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

export const configurationItemCategoryFields = baseFields;
