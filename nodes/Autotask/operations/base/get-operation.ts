import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { OperationType } from '../../types/base/entity-types';
import { BaseOperation } from './base-operation';
import { FieldProcessor } from './field-processor';
import { filterEntityBySelectedColumns, getSelectedColumns } from '../common/select-columns';

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
		let entity = await this.getEntityById(itemIndex, entityId as string | number) as T;

		// Get field processor instance for enrichment
		const fieldProcessor = FieldProcessor.getInstance(
			this.entityType,
			this.operation,
			this.context,
		);

		// Check if reference labels should be added (this must be done before picklist labels)
		try {
			const addReferenceLabels = this.context.getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;

			if (addReferenceLabels) {
				console.debug(`[GetOperation] Adding reference labels for ${this.entityType} entity`);
				// Enrich entity with reference labels
				entity = await fieldProcessor.enrichWithReferenceLabels(entity) as T;
			}
		} catch (error) {
			// If parameter doesn't exist or there's an error, log it but don't fail the operation
			console.warn(`[GetOperation] Error processing reference labels: ${error.message}`);
		}

		// Check if picklist labels should be added
		try {
			const addPicklistLabels = this.context.getNodeParameter('addPicklistLabels', itemIndex, false) as boolean;

			if (addPicklistLabels) {
				console.debug(`[GetOperation] Adding picklist labels for ${this.entityType} entity`);
				// Enrich entity with picklist labels
				entity = await fieldProcessor.enrichWithPicklistLabels(entity) as T;
			}
		} catch (error) {
			// If parameter doesn't exist or there's an error, log it but don't fail the operation
			console.warn(`[GetOperation] Error processing picklist labels: ${error.message}`);
		}

		// Filter entity by selected columns
		const selectedColumns = getSelectedColumns(this.context, itemIndex);
		return filterEntityBySelectedColumns(entity, selectedColumns) as T;
	}
}
