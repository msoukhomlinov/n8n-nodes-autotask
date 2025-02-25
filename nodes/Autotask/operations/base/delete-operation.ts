import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { OperationType } from '../../types/base/entity-types';
import { autotaskApiRequest } from '../../helpers/http';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { BaseOperation } from './base-operation';

/**
 * Base class for deleting entities
 */
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
	async execute(itemIndex: number): Promise<void> {
		return await handleErrors(
			this.context,
			async () => {
				// Get entity ID using the same parameter handling as other operations
				const entityId = await this.getParameter('id', itemIndex);
				if (!entityId || (typeof entityId !== 'string' && typeof entityId !== 'number')) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity ID is required for delete operation')
					);
				}

				// Get entity metadata to check for optional parent ID
				const metadata = getEntityMetadata(this.entityType);
				let endpoint = `/${this.entityType}/${entityId}`;

				// For delete operations, parent ID is optional
				if (metadata?.childOf) {
					try {
						const parentIdField = `${metadata.childOf}ID`;
						const parentId = await this.getParameter(parentIdField, itemIndex);

						if (parentId && (typeof parentId === 'string' || typeof parentId === 'number')) {
							// Use singular form for both parent and child entities
							endpoint = `/${metadata.childOf}/${parentId}/${this.entityType}/${entityId}`;
						}
					} catch {
						// Parent ID is optional for delete operations
					}
				}

				// Delete entity using autotaskApiRequest's built-in pluralization
				await autotaskApiRequest.call(
					this.context,
					'DELETE',
					endpoint,
				);
			},
			{
				operation: 'delete',
				entityType: this.entityType,
			},
		);
	}
}
