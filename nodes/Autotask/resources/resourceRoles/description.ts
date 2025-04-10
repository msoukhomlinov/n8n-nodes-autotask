import type { INodeProperties } from 'n8n-workflow';

export const resourceRoleFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: [
          'resourceRole',
        ],
      },
    },
    options: [
      {
        name: 'Get',
        value: 'get',
        description: 'Get a resource role by ID',
        action: 'Get a resource role',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many resource roles (only active roles are returned)',
        action: 'Get many resource roles',
      },
      {
        name: 'Count',
        value: 'count',
        description: 'Count resource roles (only active roles are counted)',
        action: 'Count resource roles',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'Resource Role ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['resourceRole'],
        operation: ['get'],
      },
    },
    description: 'The ID of the resource role to retrieve',
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
        resource: ['resourceRole'],
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
