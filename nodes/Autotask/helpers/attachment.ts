/**
 * Shared utilities for Autotask attachment operations
 * Provides constants and validation functions for attachment entities
 */

/**
 * Attachment type constant for FILE_ATTACHMENT
 */
export const ATTACHMENT_TYPE = 'FILE_ATTACHMENT';

/**
 * Maximum attachment size in bytes (6MB)
 * API limit is 6-7MB, using conservative 6MB limit
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024;

import type { IDataObject } from 'n8n-workflow';

/**
 * Interface for attachment creation payload
 */
export interface IAttachmentPayload extends IDataObject {
	id: number;
	attachmentType: string;
	data: string;
	fullPath: string;
	title: string;
	publish: number;
	ticketID?: number;
	ticketNoteID?: number;
	timeEntryID?: number;
	parentAttachmentID?: number;
}

/**
 * Validates attachment file size against API limits
 * @param sizeBytes - File size in bytes
 * @throws Error if file size exceeds maximum allowed size
 */
export function validateAttachmentSize(sizeBytes: number): void {
	if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
		throw new Error(
			`Attachment exceeds maximum size of ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB`
		);
	}
}
