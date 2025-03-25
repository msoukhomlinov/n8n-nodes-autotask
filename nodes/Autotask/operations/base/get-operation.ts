import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { OperationType } from '../../types/base/entity-types';
import { BaseOperation } from './base-operation';
import { FieldProcessor } from './field-processor';
import { flattenUdfs } from '../../helpers/udf/flatten';
import { getSelectedColumns } from '../common/select-columns';
import { GetManyOperation } from './get-many';
import { FilterOperators } from '../../constants/filters';

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

		// Check if columns are selected
		const selectedColumns = getSelectedColumns(this.context, itemIndex);
		let entity: T;

		if (selectedColumns && selectedColumns.length > 0) {
			// If columns are selected, use a GetManyOperation with ID filter
			// This is because IncludeFields works properly with query operations but not with get-by-id
			console.debug(`[GetOperation] Using GetManyOperation for ${this.entityType} because ${selectedColumns.length} columns are selected`);

			// Create GetManyOperation instance
			const getManyOp = new GetManyOperation<T>(this.entityType, this.context, { parentType: this.parentType });

			// Create filter for specific ID
			const filter = {
				filter: [
					{
						field: 'id',
						op: FilterOperators.eq,
						value: entityId,
					},
				],
			};

			// Execute query - this will handle selected columns automatically
			const results = await getManyOp.execute(filter, itemIndex);

			// Check if we got exactly one result
			if (results.length !== 1) {
				throw new Error(
					ERROR_TEMPLATES.notFound
						.replace('{type}', 'NotFoundError')
						.replace('{entity}', this.entityType)
						.replace('{details}', `Entity with ID ${entityId} not found or returned multiple results`)
				);
			}

			// Use the single result
			entity = results[0];
		} else {
			// No columns selected, use original implementation with getEntityById
			console.debug(`[GetOperation] Using standard getEntityById for ${this.entityType} as no columns are selected`);
			entity = await this.getEntityById(itemIndex, entityId as string | number) as T;
		}

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

		// Check if UDFs should be flattened
		try {
			const shouldFlattenUdfs = this.context.getNodeParameter('flattenUdfs', itemIndex, false) as boolean;

			if (shouldFlattenUdfs && entity.userDefinedFields) {
				console.debug(`[GetOperation] Flattening UDFs for ${this.entityType} entity`);
				entity = flattenUdfs(entity);
			}
		} catch (error) {
			// If parameter doesn't exist or there's an error, log it but don't fail the operation
			console.warn(`[GetOperation] Error flattening UDFs: ${error.message}`);
		}

		// Return entity directly without client-side filtering
		console.debug(`[GetOperation] Returning ${this.entityType} entity from API response`);
		return entity;
	}
}
