import type { IEntityField, ResourceMapperField } from '../../types/base/entities';
import type { FieldProcessor } from '../../operations/base/field-processor';

export type ConversionMode = 'read' | 'write';

export interface ConversionContext {
	field: IEntityField;
	mode: ConversionMode;
	fieldProcessor: FieldProcessor;
	operation?: string;
	entityType: string;  // The type of entity being processed
}

export interface ConversionStep {
	name: string;
	handler: (context: ConversionContext) => Partial<ResourceMapperField> | null;
}

export interface ConversionResult {
	value: unknown;
	error?: string;
}
