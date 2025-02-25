import type { ILoadOptionsFunctions, IHookFunctions, IExecuteFunctions } from 'n8n-workflow';
import type { IEntityInfo } from '../../types/base/entities';
import type { IAutotaskField } from '../../types/base/entity-types';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import type { FieldType } from './api';
import { getFields, getEntityInfo } from './api';
import { getPicklistValues } from './picklist';

/**
 * Generic entity helper that handles raw API interactions for Autotask entities
 */
export class EntityHelper {
	constructor(
		protected readonly entityType: string,
		public readonly context: ILoadOptionsFunctions | IHookFunctions | IExecuteFunctions,
	) {}

	/**
	 * Gets the entity type
	 */
	getEntityType(): string {
		return this.entityType;
	}

	/**
	 * Gets field definitions from the Autotask API
	 * Handles both standard and UDF fields
	 */
	async getFields(options: { fieldType?: FieldType; isActive?: boolean } = {}): Promise<IAutotaskField[] | IUdfFieldDefinition[]> {
		const { fieldType = 'standard', isActive } = options;

		// Fetch from API
		const fields = await getFields(this.entityType, this.context, options);

		// Filter and cast based on field type
		const filteredFields = fields.filter(field => !isActive || field.isActive === isActive);
		return fieldType === 'udf'
			? filteredFields.map(field => field as IUdfFieldDefinition)
			: filteredFields.map(field => field as IAutotaskField);
	}

	/**
	 * Gets raw entity information from the API
	 */
	async getEntityInfo(): Promise<IEntityInfo> {
		return await getEntityInfo(this.entityType, this.context);
	}

	/**
	 * Gets raw picklist values for a field from the API
	 */
	async getPicklistValues(
		fieldName: string,
	): Promise<Array<{ value: string; label: string; isDefaultValue: boolean; sortOrder: number; isActive: boolean }>> {
		const values = await getPicklistValues(this.entityType, fieldName, this);
		return values;
	}

	/**
	 * Gets the context object used for API requests
	 */
	getContext(): ILoadOptionsFunctions | IHookFunctions | IExecuteFunctions {
		return this.context;
	}
}
