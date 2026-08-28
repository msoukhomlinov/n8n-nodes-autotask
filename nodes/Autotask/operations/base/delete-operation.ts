import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest, buildEntityUrl, buildChildEntityUrl } from '../../helpers/http';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { BaseOperation } from './base-operation';
import { isDryRunEnabled, createDryRunResponse, type DryRunResponse } from '../../helpers/dry-run';

/**
 * Base class for deleting entities
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class DeleteOperation<T extends IAutotaskEntity> extends BaseOperation {
	constructor(
		entityType: string,
		context: IExecuteFunctions,
	) {
		super(entityType, OperationType.DELETE, context);
	}

	/**
	 * Execute delete operation
	 */
	async execute(itemIndex: number): Promise<void | DryRunResponse> {
		return await handleErrors(
			this.context,
			async () => {
				// Get entity ID using the same parameter handling as other operations
				const entityId = await this.getParameter('id', itemIndex);
				if (entityId === undefined || entityId === null || (typeof entityId !== 'string' && typeof entityId !== 'number')) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity ID is required for delete operation')
					);
				}

				// Get entity metadata to check for optional parent ID
				const metadata = getEntityMetadata(this.entityType);
				// buildEntityUrl/buildChildEntityUrl gate the id segment on truthiness, so a
				// numeric 0 (a legitimate ID) would silently produce a collection URL. Stringify
				// so "0" stays a real path segment.
				const idSegment = String(entityId);
				let endpoint = buildEntityUrl(this.entityType, { entityId: idSegment });

				// For delete operations, parent ID is optional
				if (metadata?.childOf) {
					try {
						const parentIdField = metadata.parentIdField || `${metadata.childOf}ID`;
						const rawParentId = await this.getParameter(parentIdField, itemIndex);
						const parentId = typeof rawParentId === 'string' ? rawParentId.trim() : rawParentId;

						if (
							parentId !== undefined &&
							parentId !== null &&
							parentId !== '' &&
							(typeof parentId === 'string' || typeof parentId === 'number')
						) {
							// Same normalized (pluralized) URL construction used by the live DELETE call,
							// so the dry-run preview matches the request that would actually be sent.
							endpoint = buildChildEntityUrl(metadata.childOf, this.entityType, parentId, { entityId: idSegment });
						}
					} catch {
						// Parent ID is optional for delete operations
					}
				}

			// Check for dry-run mode
			if (isDryRunEnabled(this.context, itemIndex)) {
				console.debug('[DeleteOperation] Dry-run mode enabled, returning request preview');
				const preview = await createDryRunResponse(
					this.context,
					this.entityType,
					'delete',
					{
						method: 'DELETE',
						url: endpoint,
					},
					itemIndex
				);
				return preview;
			}

			// Delete entity using autotaskApiRequest's built-in pluralization
			await autotaskApiRequest.call(
				this.context,
				'DELETE',
				endpoint,
			);
			return;
		},
		{
			operation: 'delete',
			entityType: this.entityType,
		},
	);
}
}
