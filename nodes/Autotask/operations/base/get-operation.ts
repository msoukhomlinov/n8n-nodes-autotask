import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { OperationType } from '../../types/base/entity-types';
import { BaseOperation } from './base-operation';

/**
 * Base class for getting entities
 */
export class GetOperation<T extends IAutotaskEntity> extends BaseOperation {
	constructor(
		entityType: string,
		context: IExecuteFunctions,
		parentType?: string,
	) {
		super(entityType, OperationType.READ, context, parentType);
	}

	/**
	 * Execute get operation
	 */
	async execute(itemIndex: number): Promise<T> {
		// Get entity ID from node parameters
		const entityId = await this.getParameter('id', itemIndex);
		if (!entityId || (typeof entityId !== 'string' && typeof entityId !== 'number')) {
			throw new Error(
				ERROR_TEMPLATES.validation
					.replace('{type}', 'ValidationError')
					.replace('{entity}', this.entityType)
					.replace('{details}', 'Entity ID is required for get operation')
			);
		}

		// Use the base class's getEntityById method
		return await this.getEntityById(itemIndex, entityId as string | number) as T;
	}
}
