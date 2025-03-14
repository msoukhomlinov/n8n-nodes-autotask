import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import type { IAuthHeaders } from '../nodes/Autotask/types';
import moment from 'moment-timezone';
import { CacheService } from '../nodes/Autotask/helpers/cache';

export class AutotaskApi implements ICredentialType {
	name = 'autotaskApi';
	displayName = 'Autotask API';
	documentationUrl = 'https://ww6.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm';
	properties: INodeProperties[] = [
		{
			displayName: 'API Integration Code',
			name: 'APIIntegrationcode',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'The unique API Integration Code from your Autotask account (found in Admin > API User Security)',
		},
		{
			displayName: 'Username',
			name: 'Username',
			type: 'string',
			default: '',
			required: true,
			description: 'Username of your Autotask account (must have API access enabled)',
		},
		{
			displayName: 'Secret',
			name: 'Secret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Secret key obtained from Autotask API User Security settings',
		},
		{
			displayName: 'Zone',
			name: 'zone',
			type: 'options',
			options: [
				{
					name: 'Pre-release',
					value: 'https://webservices2.autotask.net/atservicesrest',
				},
				{
					name: 'Pre-release (UK)',
					value: 'https://webservices11.autotask.net/atservicesrest',
				},
				{
					name: 'Limited Release',
					value: 'https://webservices1.autotask.net/atservicesrest',
				},
				{
					name: 'Limited Release (UK)',
					value: 'https://webservices17.autotask.net/atservicesrest',
				},
				{
					name: 'America East',
					value: 'https://webservices3.autotask.net/atservicesrest',
				},
				{
					name: 'America East 2',
					value: 'https://webservices14.autotask.net/atservicesrest',
				},
				{
					name: 'America East 3',
					value: 'https://webservices22.autotask.net/atservicesrest',
				},
				{
					name: 'America West',
					value: 'https://webservices5.autotask.net/atservicesrest',
				},
				{
					name: 'America West 2',
					value: 'https://webservices15.autotask.net/atservicesrest',
				},
				{
					name: 'America West 3',
					value: 'https://webservices24.autotask.net/atservicesrest',
				},
				{
					name: 'America West 4',
					value: 'https://webservices25.autotask.net/atservicesrest',
				},
				{
					name: 'UK',
					value: 'https://webservices4.autotask.net/atservicesrest',
				},
				{
					name: 'UK2',
					value: 'https://webservices16.autotask.net/atservicesrest',
				},
				{
					name: 'UK3',
					value: 'https://webservices28.autotask.net/atservicesrest',
				},
				{
					name: 'Australia / New Zealand',
					value: 'https://webservices6.autotask.net/atservicesrest',
				},
				{
					name: 'Australia 2',
					value: 'https://webservices26.autotask.net/atservicesrest',
				},
				{
					name: 'Pre-Release (Deutsch)',
					value: 'https://prde.autotask.net/atservicesrest',
				},
				{
					name: 'Pre-Release (Español)',
					value: 'https://pres.autotask.net/atservicesrest',
				},
				{
					name: 'German (Deutsch)',
					value: 'https://webservices18.autotask.net/atservicesrest',
				},
				{
					name: 'EU1 (English Europe and Asia)',
					value: 'https://webservices19.autotask.net/atservicesrest',
				},
				{
					name: 'Spanish (Español)',
					value: 'https://webservices12.autotask.net/atservicesrest',
				},
				{
					name: 'Other (Use Zone Information API)',
					value: 'other',
				},
			],
			default: 'https://webservices6.autotask.net/atservicesrest',
			required: true,
			description: 'Select your Autotask instance zone. If unsure, use "Other" which will automatically detect your zone. Zone list sourced from: https://ww6.autotask.net/help/developerhelp/Content/APIs/General/API_Zones.htm',
		},
		{
			displayName: 'Custom Zone URL',
			name: 'customZoneUrl',
			type: 'string',
			default: 'https://webservices.autotask.net/atservicesrest',
			required: true,
			displayOptions: {
				show: {
					zone: ['other'],
				},
			},
			description: 'Enter your custom Autotask zone URL. You can find your zone URL using the Zone Information API or from your Autotask administrator.',
		},
		{
			displayName: 'Timezone',
			name: 'timezone',
			type: 'options',
			options: moment.tz.names().map((tz: string) => ({ name: tz, value: tz })),
			default: 'UTC',
			required: true,
			description: 'Select your timezone. All dates/times in the Autotask API are in UTC and will be automatically converted to/from this timezone.',
			hint: 'This setting affects how dates and times are displayed and entered in the node. The API always uses UTC internally.',
		},
		// Cache Configuration
		{
			displayName: 'Enable Field Caching',
			name: 'cacheEnabled',
			type: 'boolean',
			default: true,
			description: 'Whether to cache field values to reduce API calls',
		},
		{
			displayName: 'Cache TTL',
			name: 'cacheTTL',
			type: 'number',
			default: 86400,
			description: 'How long to cache field values (in seconds)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
		{
			displayName: 'Cache Entity Info',
			name: 'cacheEntityInfo',
			type: 'boolean',
			default: true,
			description: 'Whether to cache entity information and field definitions',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
		{
			displayName: 'Entity Info TTL',
			name: 'cacheEntityInfoTTL',
			type: 'number',
			default: 86400,
			description: 'How long to cache entity information (in seconds)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
					cacheEntityInfo: [true],
				},
			},
		},
		{
			displayName: 'Cache Reference Fields',
			name: 'cacheReferenceFields',
			type: 'boolean',
			default: true,
			description: 'Whether to cache reference field values',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
		{
			displayName: 'Reference Fields TTL',
			name: 'cacheReferenceTTL',
			type: 'number',
			default: 86400,
			description: 'How long to cache reference field values (in seconds)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
					cacheReferenceFields: [true],
				},
			},
		},
		{
			displayName: 'Cache Picklists',
			name: 'cachePicklists',
			type: 'boolean',
			default: true,
			description: 'Whether to cache picklist values',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
		{
			displayName: 'Picklists TTL',
			name: 'cachePicklistsTTL',
			type: 'number',
			default: 86400,
			description: 'How long to cache picklist values (in seconds)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
					cachePicklists: [true],
				},
			},
		},
		{
			displayName: 'Cache Directory',
			name: 'cacheDirectory',
			type: 'string',
			default: './cache/autotask',
			description: 'Directory to store cache files (relative or absolute path)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
		{
			displayName: 'Maximum Cache Size (MB)',
			name: 'cacheMaxSize',
			type: 'number',
			default: 100,
			description: 'Maximum size of the cache in megabytes (0 for unlimited)',
			displayOptions: {
				show: {
					cacheEnabled: [true],
				},
			},
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				APIIntegrationcode: '={{$credentials.APIIntegrationcode}}',
				Username: '={{$credentials.Username}}',
				Secret: '={{$credentials.Secret}}',
				'Content-Type': 'application/json',
			} as IAuthHeaders,
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.zone === "other" ? $credentials.customZoneUrl : $credentials.zone}}/V1.0',
			url: '/Companies/entityInformation',
			method: 'GET',
			headers: {
				APIIntegrationcode: '={{$credentials.APIIntegrationcode}}',
				Username: '={{$credentials.Username}}',
				Secret: '={{$credentials.Secret}}',
				'Content-Type': 'application/json',
			} as IAuthHeaders,
		},
	};

	preValidate() {
		// Clear all cache instances when testing credentials
		// This ensures cache is reinitialized with new settings
		CacheService.clearAllInstances();
	}
}
