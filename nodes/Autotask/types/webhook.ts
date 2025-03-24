import type { IDataObject } from 'n8n-workflow';

/**
 * Autotask webhook entity type enum
 */
export enum AutotaskWebhookEntityType {
	CONTACTS = 'Contacts',
	COMPANIES = 'Companies',
	TICKETS = 'Tickets',
	CONFIGURATIONITEMS = 'ConfigurationItems',
	TICKETNOTES = 'TicketNotes',
	COMPANYWEBHOOKS = 'CompanyWebhooks',
	CONFIGURATIONITEMWEBHOOKS = 'ConfigurationItemWebhooks',
	CONTACTWEBHOOKS = 'ContactWebhooks',
	TICKETNOTEWEBHOOKS = 'TicketNoteWebhooks',
}

/**
 * Autotask webhook event type enum
 */
export enum AutotaskWebhookEventType {
	CREATE = 'Create',
	UPDATE = 'Update',
	DELETE = 'Delete',
	DEACTIVATED = 'Deactivated', // Special event type sent when a webhook is deactivated
}

/**
 * Interface for Autotask webhook
 */
export interface IAutotaskWebhook {
	id?: number;
	isActive: boolean;
	name: string;
	secretKey?: string;
	webhookUrl: string;
	deactivationUrl: string;
	entityType: string;
	eventType?: AutotaskWebhookEventType; // Keep for backward compatibility
	isSubscribedToCreateEvents?: boolean;
	isSubscribedToUpdateEvents?: boolean;
	isSubscribedToDeleteEvents?: boolean;
	notificationEmailAddress?: string;
	sendThresholdExceededNotification?: boolean;
	ownerResourceID?: number;
	isReady?: boolean; // Read-only
	webhookGUID?: string; // Server-generated
	// The date this webhook was last modified
	lastModifiedDate?: string;
}

/**
 * Interface for Autotask webhook payload
 */
export interface IAutotaskWebhookPayload extends IDataObject {
	eventType: AutotaskWebhookEventType;
	entityType: AutotaskWebhookEntityType;
	entityId: number;
	entityData: IDataObject;
	timestamp: string;
	webhookId: number;
	secretKey?: string;
}

/**
 * Interface for raw Autotask webhook payload as received from API
 * This reflects the actual payload structure sent by Autotask
 */
export interface IAutotaskRawWebhookPayload extends IDataObject {
	Action: string; // Corresponds to eventType
	Guid: string; // Unique identifier for the webhook event
	EntityType: string; // Corresponds to entityType
	Id: number; // Corresponds to entityId
	Fields: IDataObject; // Corresponds to entityData
	EventTime: string; // Corresponds to timestamp
	SequenceNumber: number; // Incremental counter for webhook events
	PersonID: number; // Resource ID of the user who triggered the event
}

/**
 * Interface for Autotask webhook creation/update parameters
 */
export interface IAutotaskWebhookParams extends IDataObject {
	name: string;
	active: boolean;
	entityType: AutotaskWebhookEntityType;
	notificationEmailAddress?: string;
	subscribeToEvents: AutotaskWebhookEventType[];
	webhookUrl: string;
	secretKey?: string;
	includeFields?: string[];
	excludeFields?: string[];
}

/**
 * Options for webhook operations
 */
export interface IWebhookOptions {
	webhookId?: number;
	entityType?: string;
	eventType?: AutotaskWebhookEventType;
	name?: string;
	webhookUrl?: string;
	isActive?: boolean;
	fields?: Array<{ fieldName: string; isDisplayAlwaysField?: boolean }>;
	udfFields?: Array<{ udfFieldId: number }>;
	excludedResources?: Array<{ resourceId: number }>;
}
