import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../../types';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { OperationType } from '../../types/base/entity-types';
import { BaseOperation } from './base-operation';
import { flattenUdfs } from '../../helpers/udf/flatten';
import { getSelectedColumns } from '../common/select-columns';
import { GetManyOperation } from './get-many';
import { FilterOperators } from '../../constants/filters';
import { processOutputMode } from '../../helpers/output-mode';

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
		if (entityId === undefined || entityId === null || (typeof entityId !== 'string' && typeof entityId !== 'number')) {
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

		// Apply output mode processing (handles enrichment and formatting)
		entity = await processOutputMode(entity, this.entityType, this.context, itemIndex) as T;

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
