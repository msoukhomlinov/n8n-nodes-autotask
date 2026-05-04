import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest, buildEntityUrl, buildChildEntityUrl } from './http';
import { buildRequestBody } from './http/body-builder';
import { withInactiveRefRetry } from './inactive-entity-activation';
import { extractId } from './dedup-utils';
import { getEntityMetadata } from '../constants/entities';
import { OperationType } from '../types/base/entity-types';

/**
 * Shared POST layer for all compound createIfNotExists helpers.
 * Handles body-building (UDF splitting, id:0 for child entities),
 * endpoint construction, and withInactiveRefRetry.
 *
 * @param opts.endpoint - Required when Autotask URL differs from the
 *   buildChildEntityUrl derivation (e.g. Expenses/{id}/Items, not ExpenseItems).
 */
export async function performCreate(
	ctx: IExecuteFunctions,
	entityType: string,
	fields: IDataObject,
	opts: {
		endpoint?: string;
		impersonationResourceId?: number;
		proceedWithoutImpersonationIfDenied?: boolean;
	} = {},
): Promise<{ id: number; warnings: string[] }> {
	const { body } = await buildRequestBody({
		validatedData: fields,
		entityType,
		operation: 'create',
		ctx,
	});

	let endpoint: string;
	if (opts.endpoint) {
		endpoint = opts.endpoint;
	} else {
		const metadata = getEntityMetadata(entityType);
		if (metadata?.childOf) {
			const parentIdField = metadata.parentIdField ?? `${metadata.childOf}ID`;
			const parentId = fields[parentIdField] as string | number;
			endpoint = buildChildEntityUrl(metadata.childOf, entityType, parentId);
		} else {
			endpoint = buildEntityUrl(entityType);
		}
	}

	const inactiveRefWarnings: string[] = [];
	const response = await withInactiveRefRetry(
		ctx,
		inactiveRefWarnings,
		() => autotaskApiRequest.call(
			ctx,
			'POST',
			endpoint,
			body,
			{},
			opts.impersonationResourceId,
			opts.proceedWithoutImpersonationIfDenied ?? true,
		),
		fields,
	) as IDataObject;

	const id = extractId(response);
	if (!id) {
		throw new Error(`performCreate: creation of ${entityType} succeeded but returned no ID.`);
	}

	return { id, warnings: inactiveRefWarnings };
}

/**
 * Shared PATCH layer for applyDuplicateUpdate.
 * Handles body-building (UDF splitting, id in body),
 * endpoint construction, and withInactiveRefRetry.
 *
 * @param opts.parentId - Required when entity metadata has operations.update === 'parent'.
 */
export async function performPatch(
	ctx: IExecuteFunctions,
	entityType: string,
	entityId: number,
	patch: IDataObject,
	opts: {
		parentId?: number;
		impersonationResourceId?: number;
		proceedWithoutImpersonationIfDenied?: boolean;
	} = {},
): Promise<{ response: IDataObject; warnings: string[] }> {
	const warnings: string[] = [];

	if (Object.keys(patch).length === 0) {
		return {
			response: {},
			warnings: ['applyDuplicateUpdate called with empty patch — skipped'],
		};
	}

	const metadata = getEntityMetadata(entityType);

	if (metadata?.childOf && metadata.operations?.[OperationType.UPDATE] === 'parent' && !opts.parentId) {
		throw new Error(`performPatch: parentId is required for parent-mode child entity '${entityType}'`);
	}

	const { body } = await buildRequestBody({
		validatedData: patch,
		entityType,
		entityId,
		operation: 'update',
		ctx,
	});

	let endpoint: string;
	if (metadata?.childOf && metadata.operations?.[OperationType.UPDATE] === 'parent') {
		endpoint = buildChildEntityUrl(metadata.childOf, entityType, opts.parentId!);
	} else if (metadata) {
		endpoint = buildEntityUrl(entityType);
	} else {
		warnings.push(`performPatch: unknown entity '${entityType}' — metadata not found, constructing PATCH URL manually.`);
		endpoint = `${entityType}s`;
	}

	const inactiveRefWarnings: string[] = [];
	const response = await withInactiveRefRetry(
		ctx,
		inactiveRefWarnings,
		() => autotaskApiRequest.call(
			ctx,
			'PATCH',
			endpoint,
			body,
			{},
			opts.impersonationResourceId,
			opts.proceedWithoutImpersonationIfDenied ?? true,
		),
		patch,
	) as IDataObject;

	return {
		response: response ?? {},
		warnings: [...warnings, ...inactiveRefWarnings],
	};
}
