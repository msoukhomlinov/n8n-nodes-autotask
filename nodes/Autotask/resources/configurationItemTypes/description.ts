import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
  {
    name: 'Create',
    value: 'create',
    description: 'Create a configuration item type',
    action: 'Create a configuration item type',
  },
  {
    name: 'Update',
    value: 'update',
    description: 'Update a configuration item type',
    action: 'Update a configuration item type',
  },
  {
    name: 'Get',
    value: 'get',
    description: 'Get a configuration item type by ID',
    action: 'Get a configuration item type',
  },
  {
    name: 'Get Many',
    value: 'getMany',
    description: 'Get multiple configuration item types using field filters',
    action: 'Get multiple configuration item types',
  },
  {
    name: 'Delete',
    value: 'delete',
    description: 'Delete a configuration item type',
    action: 'Delete a configuration item type',
  },
  {
    name: 'Count',
    value: 'count',
    description: 'Count number of configuration item types',
    action: 'Count configuration item types',
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
          'configurationItemTypes',
        ],
      },
    },
    options: operationOptions,
    default: 'get',
  },
  {
    displayName: 'Configuration Item Type ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItemTypes'],
        operation: ['update', 'get', 'delete'],
      },
    },
    description: 'The ID of the configuration item type to operate on',
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
        resource: ['configurationItemTypes'],
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

export const configurationItemTypeFields = baseFields;
