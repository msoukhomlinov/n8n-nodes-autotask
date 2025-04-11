import type { INodeProperties } from 'n8n-workflow';

export const roleFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: [
          'role',
        ],
      },
    },
    options: [
      {
        name: 'Create',
        value: 'create',
        description: 'Create a role',
        action: 'Create a role',
      },
      {
        name: 'Get',
        value: 'get',
        description: 'Get a role by ID',
        action: 'Get a role',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many roles',
        action: 'Get many roles',
      },
      {
        name: 'Update',
        value: 'update',
        description: 'Update a role',
        action: 'Update a role',
      },
    ],
    default: 'get',
  },
  // Fields for GET operation
  {
    displayName: 'Role ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['role'],
        operation: ['get', 'update'],
      },
    },
    description: 'The ID of the role to retrieve or update',
  },
  // Fields for CREATE
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
        resource: ['role'],
        operation: ['create'],
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
  // Fields for UPDATE
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'resourceMapper',
    default: {
      mappingMode: 'defineBelow',
      value: null,
    },
    required: true,
    displayOptions: {
      show: {
        resource: ['role'],
        operation: ['update'],
      },
    },
    typeOptions: {
      loadOptionsDependsOn: ['resource', 'operation'],
      resourceMapper: {
        resourceMapperMethod: 'getFields',
        mode: 'update',
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
  // Fields for GET MANY
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
        resource: ['role'],
        operation: ['getMany'],
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
