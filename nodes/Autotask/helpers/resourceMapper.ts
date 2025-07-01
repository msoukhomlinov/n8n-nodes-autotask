import type { ILoadOptionsFunctions, ResourceMapperFields, IExecuteFunctions } from 'n8n-workflow';
import { WRITE_OPERATIONS } from '../operations/base/types';
import type { ResourceOperation } from '../types/base/common';
import type { OperationType } from '../types/base/entity-types';
import { FieldProcessor } from '../operations/base/field-processor';
import { handleErrors } from './errorHandler';
import { getFields } from './entity/api';

/**
 * Get resource mapper fields for an entity type
 * Combines regular fields and UDF fields into a unified format
 */
export async function getResourceMapperFields(
	this: ILoadOptionsFunctions,
	entityType: string,
): Promise<ResourceMapperFields> {
	return await handleErrors(this as unknown as IExecuteFunctions, async () => {
		const operation = this.getNodeParameter('operation', 0) as ResourceOperation;
		const mode = WRITE_OPERATIONS.includes(operation as OperationType.CREATE | OperationType.UPDATE | OperationType.DELETE) ? 'write' : 'read';

		console.debug(`[getResourceMapperFields] Starting to fetch fields for ${entityType} (mode: ${mode})`);

		// Get both standard and UDF fields using the unified API
		const [standardApiFields, udfApiFields] = await Promise.all([
			getFields(entityType, this, { fieldType: 'standard', }),
			getFields(entityType, this, { fieldType: 'udf', isActive: true }),
		]);

		// Summarise fetched field stats
		const udfPicklistCount = udfApiFields.filter(field => 'isPickList' in field && field.isPickList === true).length;
		console.debug(`[getResourceMapperFields] Retrieved ${standardApiFields.length} standard, ${udfApiFields.length} UDF (${udfPicklistCount} picklists) fields for ${entityType}`);

		// Get processor instance
		const processor = FieldProcessor.getInstance(
			entityType,
			operation,
			this as unknown as IExecuteFunctions,
		);

		// Process fields separately to maintain type safety
		const [{ fields: standardFields }, { fields: udfFields }] = await Promise.all([
			processor.processFields(standardApiFields, operation, {
				mode,
				fieldType: 'standard',
			}),
			processor.processFields(udfApiFields, operation, {
				mode,
				fieldType: 'udf',
			}),
		]);

		console.debug(`[getResourceMapperFields] Processed ${standardFields.length} standard fields and ${udfFields.length} UDF fields for ${entityType}`);

		// Combine and deduplicate fields
		const uniqueFields = new Map();
		for (const field of [...standardFields, ...udfFields]) {
			const key = `${field.id}_${field.type}`;
			if (!uniqueFields.has(key)) {
				uniqueFields.set(key, field);
			}
		}

		const resultFields = Array.from(uniqueFields.values()).map(field => ({
			...field,
			defaultMatch: false,
		}));

		console.debug(`[getResourceMapperFields] Returning ${resultFields.length} unique fields for ${entityType}`);

		// Add defaultMatch property
		return {
			fields: resultFields,
		};
	});
}
