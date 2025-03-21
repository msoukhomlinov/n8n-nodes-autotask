import type { INodeProperties } from 'n8n-workflow';

const operationOptions = [
  {
    name: 'Create',
    value: 'create',
    description: 'Create a configuration item category UDF association',
    action: 'Create a configuration item category UDF association',
  },
  {
    name: 'Update',
    value: 'update',
    description: 'Update a configuration item category UDF association',
    action: 'Update a configuration item category UDF association',
  },
  {
    name: 'Get',
    value: 'get',
    description: 'Get a configuration item category UDF association by ID',
    action: 'Get a configuration item category UDF association',
  },
  {
    name: 'Get Many',
    value: 'getMany',
    description: 'Get multiple configuration item category UDF associations using field filters',
    action: 'Get multiple configuration item category UDF associations',
  },
  {
    name: 'Count',
    value: 'count',
    description: 'Count number of configuration item category UDF associations',
    action: 'Count configuration item category UDF associations',
  },
  {
    name: 'Delete',
    value: 'delete',
    description: 'Delete a configuration item category UDF association',
    action: 'Delete a configuration item category UDF association',
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
          'configurationItemCategoryUdfAssociation',
        ],
      },
    },
    options: operationOptions,
    default: 'get',
  },
  {
    displayName: 'Configuration Item Category ID',
    name: 'configurationItemCategoryID',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItemCategoryUdfAssociation'],
        operation: ['create', 'getMany', 'count'],
      },
    },
    description: 'The ID of the configuration item category',
  },
  {
    displayName: 'Configuration Item Category UDF Association ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItemCategoryUdfAssociation'],
        operation: ['update', 'get', 'delete'],
      },
    },
    description: 'The ID of the configuration item category UDF association to operate on',
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
        resource: ['configurationItemCategoryUdfAssociation'],
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

export const configurationItemCategoryUdfAssociationFields = baseFields;
