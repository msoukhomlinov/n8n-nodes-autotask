import type { INodeProperties } from 'n8n-workflow';
import { getManyAdvancedOptions } from '../../operations/common/get-many-advanced';

export const configurationItemSslSubjectAlternativeNameFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: [
          'configurationItemSslSubjectAlternativeName',
        ],
      },
    },
    options: [
      {
        name: 'Update',
        value: 'update',
        description: 'Update a SSL subject alternative name',
        action: 'Update a SSL subject alternative name',
      },
      {
        name: 'Get',
        value: 'get',
        description: 'Get a SSL subject alternative name by ID',
        action: 'Get a SSL subject alternative name',
      },
      {
        name: 'Get Many',
        value: 'getMany',
        description: 'Get multiple SSL subject alternative names',
        action: 'Get multiple SSL subject alternative names',
      },
      {
        name: 'Delete',
        value: 'delete',
        description: 'Delete a SSL subject alternative name',
        action: 'Delete a SSL subject alternative name',
      },
      {
        name: 'Count',
        value: 'count',
        description: 'Count number of SSL subject alternative names',
        action: 'Count SSL subject alternative names',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'SSL Subject Alternative Name ID',
    name: 'id',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: {
        resource: ['configurationItemSslSubjectAlternativeName'],
        operation: ['update', 'get', 'delete'],
      },
    },
    description: 'The ID of the SSL Subject Alternative Name to operate on',
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
        resource: ['configurationItemSslSubjectAlternativeName'],
        operation: ['update', 'getMany', 'count'],
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
  ...getManyAdvancedOptions.map(option => ({
    ...option,
    displayOptions: {
      ...option.displayOptions,
      show: {
        ...(option.displayOptions?.show || {}),
        resource: ['configurationItemSslSubjectAlternativeName'],
      },
    },
  })),
];
