import type { ResourceMapperField, IEntityField } from '../../types/base/entities';
import type { FieldProcessor } from '../../operations/base/field-processor';
import type { ConversionContext, ConversionMode } from './types';
import { conversionSteps } from './steps';

/**
 * Handles the field conversion pipeline
 */
export class FieldConversionPipeline {
	private readonly steps = conversionSteps;
	private static readonly fieldTracker = new Map<string, number>();

	constructor(
		private readonly fieldProcessor: FieldProcessor,
	) {}

	/**
	 * Create conversion context
	 */
	private createContext(field: IEntityField, mode: ConversionMode, operation?: string): ConversionContext {
		return {
			field,
			mode,
			operation,
			fieldProcessor: this.fieldProcessor,
			entityType: this.fieldProcessor.getEntityType(),
		};
	}

	/**
	 * Converts a field through the pipeline
	 */
	public async convertField(field: IEntityField, mode: ConversionMode = 'read', operation?: string): Promise<ResourceMapperField | null> {
		try {
			const fieldKey = `${field.name}_${mode}_${this.fieldProcessor.constructor.name}`;
			const count = (FieldConversionPipeline.fieldTracker.get(fieldKey) || 0) + 1;
			FieldConversionPipeline.fieldTracker.set(fieldKey, count);

			const context = this.createContext(field, mode, operation);
			let result: Partial<ResourceMapperField> = {};

			for (const step of this.steps) {
				const stepResult = step.handler(context);
				if (stepResult === null) return null;
				result = { ...result, ...stepResult };
			}

			// Add required ResourceMapperField properties
			return {
				...result,
				defaultMatch: false,
				canBeUsedToMatch: mode === 'read' && field.isQueryable,
			} as ResourceMapperField;
		} catch (error) {
			throw new Error(`Field conversion failed for ${field.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Batch converts multiple fields
	 */
	public async convertFields(fields: IEntityField[], mode: ConversionMode = 'read', operation?: string): Promise<ResourceMapperField[]> {
		try {
			const results: ResourceMapperField[] = [];
			for (const field of fields) {
				const result = await this.convertField(field, mode, operation);
				if (result) results.push(result);
			}
			return results;
		} catch (error) {
			throw new Error(`Batch field conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
