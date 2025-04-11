import type { INodeProperties } from 'n8n-workflow';

export const productVendorFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: [
          'productVendor',
        ],
      },
    },
    options: [
      {
        name: 'Create',
        value: 'create',
        description: 'Create a product vendor',
        action: 'Create a product vendor',
      },
      {
        name: 'Update',
        value: 'update',
        description: 'Update a product vendor',
        action: 'Update a product vendor',
      },
      {
        name: 'Get',
        value: 'get',
        description: 'Get a product vendor by ID',
        action: 'Get a product vendor',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get multiple product vendors',
        action: 'Get multiple product vendors',
      },
      {
        name: 'Count',
        value: 'count',
        description: 'Count number of product vendors',
        action: 'Count product vendors',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'Vendor ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['productVendor'],
        operation: ['update', 'get'],
      },
    },
    description: 'The ID of the vendor to update',
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
        resource: ['productVendor'],
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
