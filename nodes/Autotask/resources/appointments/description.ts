import type { INodeProperties } from 'n8n-workflow';

export const appointmentFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: ['appointment'],
      },
    },
    options: [
      {
        name: 'Create',
        value: 'create',
        description: 'Create an appointment',
        action: 'Create an appointment',
      },
      {
        name: 'Delete',
        value: 'delete',
        description: 'Delete an appointment',
        action: 'Delete an appointment',
      },
      {
        name: 'Get',
        value: 'get',
        description: 'Get an appointment by ID',
        action: 'Get an appointment',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get many appointments',
        action: 'Get many appointments',
      },
      {
        name: 'Update',
        value: 'update',
        description: 'Update an appointment',
        action: 'Update an appointment',
      },
      {
        name: 'Count',
        value: 'count',
        description: 'Count appointments',
        action: 'Count appointments',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'Appointment ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['appointment'],
        operation: ['get', 'update', 'delete'],
      },
    },
    description: 'The ID of the appointment',
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
        resource: ['appointment'],
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
