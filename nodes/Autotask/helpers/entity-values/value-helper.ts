import type { ILoadOptionsFunctions, IExecuteFunctions, IDataObject, IHookFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../../types';
import type { GetManyOperation } from '../../operations/base/get-many';
import { GetManyOperation as GetManyOperationClass } from '../../operations/base/get-many';
import { PICKLIST_REFERENCE_FIELD_MAPPINGS } from '../../constants/field.constants';
import type { IPicklistReferenceFieldMapping } from '../../types/base/picklists';
import { ERROR_TEMPLATES, WARNING_TEMPLATES } from '../../constants/error.constants';
import type { CacheService } from '../cache';
import { EntityHelper } from '../entity';

interface IFallbackConfig {
	enabled: boolean;
	defaultValue?: string | number;
	useId?: boolean;
	customLabel?: string;
}

interface IDisplayNameOptions {
	useMapping?: boolean;
	fallback?: IFallbackConfig;
}

/**
 * Helper class for retrieving entity values
 */
export class EntityValueHelper<T extends IAutotaskEntity> {
	private readonly getManyOperation: GetManyOperation<T>;
	private readonly entityHelper: EntityHelper;
	private readonly maxReferenceDepth = 3;
	private currentDepth = 0;
	private readonly fallbackConfig: IFallbackConfig;
	private readonly cacheService?: CacheService;

	constructor(
		public readonly context: ILoadOptionsFunctions | IExecuteFunctions | IHookFunctions,
		private readonly entityType: string,
		options?: {
			fallback?: IFallbackConfig;
			cacheService?: CacheService;
		}
	) {
		// Initialize operations
		this.getManyOperation = new GetManyOperationClass(
			entityType,
			context as IExecuteFunctions,
			{
				isPicklistQuery: true,
			}
		);
		this.entityHelper = new EntityHelper(entityType, context);

		// Set fallback configuration
		this.fallbackConfig = {
			enabled: true,
			useId: true,
			...options?.fallback,
		};

		// Set cache service from options
		this.cacheService = options?.cacheService;
	}

	/**
	 * Get picklist values for a field
	 */
	public async getPicklistValues(fieldName: string): Promise<Array<{
		value: string;
		label: string;
		isDefaultValue: boolean;
		sortOrder: number;
		isActive: boolean;
	}>> {
		// Try to get values from cache first
		let values: Array<{
			value: string;
			label: string;
			isDefaultValue: boolean;
			sortOrder: number;
			isActive: boolean;
		}> | undefined;
		if (this.cacheService?.isPicklistEnabled()) {
			const cacheKey = this.cacheService.getPicklistKey(this.entityType, fieldName);
			values = await this.cacheService.get<Array<{
				value: string;
				label: string;
				isDefaultValue: boolean;
				sortOrder: number;
				isActive: boolean;
			}>>(cacheKey);
		}

		// If not in cache, fetch from API
		if (!values) {
			values = await this.entityHelper.getPicklistValues(fieldName);

			// Cache the results if caching is enabled
			if (this.cacheService?.isPicklistEnabled()) {
				const cacheKey = this.cacheService.getPicklistKey(this.entityType, fieldName);
				await this.cacheService.set(
					cacheKey,
					values,
					this.cacheService.getPicklistTTL(),
				);
			}
		}

		return values;
	}

	/**
	 * Get all values for this entity type
	 */
	public async getValues(): Promise<T[]> {
		try {
			// Apply any configured filters from PICKLIST_REFERENCE_FIELD_MAPPINGS
			const mapping = PICKLIST_REFERENCE_FIELD_MAPPINGS[this.entityType];
			const filters = {
				isActive: true, // Always filter for active records
				...(mapping?.filters || {}), // Allow overriding in mapping if needed
			};

			// Create query with filters
			const query: IAutotaskQueryInput<T> = {
				filter: Object.entries(filters).map(([field, value]) => ({
					field,
					op: 'eq',
					value: String(value),
				})),
			};

			console.debug(`Loading reference values for ${this.entityType} with filters:`, filters);

			// Get entities with filters applied
			return await this.getManyOperation.execute(query);
		} catch (error) {
			throw new Error(
				ERROR_TEMPLATES.reference
					.replace('{type}', 'GetValuesError')
					.replace('{entity}', this.entityType)
					.replace('{details}', error instanceof Error ? error.message : 'Unknown error')
			);
		}
	}

	/**
	 * Get entity values with optional filtering and sorting
	 */
	async getValuesWithFilters(
		filters: Record<string, unknown> = {},
		sortField?: string,
		sortAsc = true,
		maxResults = 20000,
	): Promise<T[]> {
		// Check reference depth to prevent infinite recursion
		if (this.currentDepth >= this.maxReferenceDepth) {
			const error = ERROR_TEMPLATES.reference
				.replace('{type}', 'MaxDepthError')
				.replace('{entity}', this.entityType)
				.replace('{details}', `Maximum reference depth of ${this.maxReferenceDepth} exceeded`);

			if (this.fallbackConfig.enabled) {
				console.warn(WARNING_TEMPLATES.reference
					.replace('{entity}', this.entityType)
					.replace('{details}', error));
				return this.getFallbackValues();
			}
			throw new Error(error);
		}

		try {
			return await this.fetchValues(filters, sortField, sortAsc, maxResults);
		} catch (error) {
			const errorMessage = ERROR_TEMPLATES.reference
				.replace('{type}', 'FetchError')
				.replace('{entity}', this.entityType)
				.replace('{details}', error instanceof Error ? error.message : 'Failed to fetch values');

			if (this.fallbackConfig.enabled) {
				console.warn(WARNING_TEMPLATES.reference
					.replace('{entity}', this.entityType)
					.replace('{details}', errorMessage));
				return this.getFallbackValues();
			}
			throw new Error(errorMessage);
		}
	}

	/**
	 * Get fallback values when normal retrieval fails
	 * @private
	 */
	private getFallbackValues(): T[] {
		if (!this.fallbackConfig.enabled) {
			throw new Error('Fallback is not enabled');
		}

		const fallbackValue = this.fallbackConfig.defaultValue || 'Unknown';
		const fallbackLabel = this.fallbackConfig.customLabel || 'Unknown Entity';

		return [{
			id: typeof fallbackValue === 'number' ? fallbackValue : -1,
			[this.entityType]: typeof fallbackValue === 'string' ? fallbackValue : fallbackLabel,
		}] as unknown as T[];
	}

	/**
	 * Fetch values from the API
	 * @private
	 */
	private async fetchValues(
		filters: Record<string, unknown> = {},
		sortField?: string,
		sortAsc = true,
		maxResults = 20000,
	): Promise<T[]> {
		// Add isActive=true to default filters
		const defaultFilters = {
			isActive: true,
			...filters, // Allow overriding default filters if needed
		};
		const query = await this.prepareQuery(defaultFilters, sortField, sortAsc);
		return await this.getManyOperation.execute(query, maxResults);
	}

	/**
	 * Prepare query input for API request
	 * @private
	 */
	private async prepareQuery(
		userFilters: Record<string, unknown>,
		sortField?: string,
		sortAsc = true,
	): Promise<IAutotaskQueryInput<T>> {
		const query: IAutotaskQueryInput<T> = {
			filter: [],
			IncludeFields: [],
		};

		// Add user filters
		for (const [field, value] of Object.entries(userFilters)) {
			if (value !== undefined && value !== null) {
				query.filter.push({
					field,
					op: 'eq',
					value: String(value),
				});
			}
		}

		// Add sorting if specified
		if (sortField) {
			query.IncludeFields = [sortField];
		}

		return query;
	}

	/**
	 * Get display name for an entity
	 */
	getEntityDisplayName(entity: IDataObject, options: IDisplayNameOptions = {}): string {
		try {
			return this.formatDisplayName(entity, options);
		} catch (error) {
			const errorMessage = ERROR_TEMPLATES.reference
				.replace('{type}', 'DisplayNameError')
				.replace('{entity}', this.entityType)
				.replace('{details}', error instanceof Error ? error.message : 'Failed to format display name');

			if (options.fallback?.enabled ?? this.fallbackConfig.enabled) {
				console.warn(WARNING_TEMPLATES.reference
					.replace('{entity}', this.entityType)
					.replace('{details}', errorMessage));
				return String(entity.id || 'Unknown');
			}
			throw new Error(errorMessage);
		}
	}

	/**
	 * Format name parts using a mapping configuration from PICKLIST_REFERENCE_FIELD_MAPPINGS
	 * @private
	 * @param entity - The entity object containing field values
	 * @param mapping - The mapping configuration defining how to format the name
	 * @returns Formatted name string or null if required fields are missing
	 * @example
	 * // With mapping { nameFields: ['firstName', 'lastName'], bracketField: 'email' }
	 * // Entity: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' }
	 * // Returns: "John Doe (john@example.com)"
	 */
	private formatMappedName(entity: IDataObject, mapping: IPicklistReferenceFieldMapping): string | null {
		// Get all name parts
		const nameParts = mapping.nameFields.map((field: string) => {
			const value = entity[field];
			return value !== undefined && value !== null ? String(value) : '';
		}).filter(Boolean);

		if (nameParts.length === 0) return null;

		// Join name parts with separator
		const name = nameParts.join(mapping.separator || ' ');
		const bracketValue = this.getBracketValue(entity, mapping.bracketField);

		return bracketValue ? `${name} (${bracketValue})` : name;
	}

	/**
	 * Extract and format bracket values from an entity
	 * @private
	 * @param entity - The entity object containing field values
	 * @param bracketField - Single field name or array of field names to use in brackets
	 * @returns Formatted bracket value string or null if no valid values found
	 * @example
	 * // Single field
	 * // bracketField: 'email' -> "(john@example.com)"
	 * // Multiple fields
	 * // bracketField: ['email', 'phone'] -> "(john@example.com, 555-0123)"
	 */
	private getBracketValue(entity: IDataObject, bracketField?: string | string[]): string | null {
		if (!bracketField) return null;

		if (Array.isArray(bracketField)) {
			const bracketParts = bracketField.map(field => {
				const value = entity[field];
				return value !== undefined && value !== null ? String(value) : '';
			}).filter(Boolean);
			return bracketParts.length > 0 ? bracketParts.join(', ') : null;
		}

		const value = entity[bracketField];
		return value !== undefined && value !== null ? String(value) : null;
	}

	/**
	 * Try to format entity using the default pattern of name + id
	 * This is the standard format used when no specific mapping exists
	 * @private
	 * @param entity - The entity object containing name and id fields
	 * @returns Formatted string "name (id)" or null if either field is missing
	 * @example
	 * // Entity: { name: "Project X", id: 123 }
	 * // Returns: "Project X (123)"
	 */
	private formatDefaultName(entity: IDataObject): string | null {
		const name = entity.name;
		const id = entity.id;
		if (name !== undefined && name !== null && id !== undefined && id !== null) {
			return `${name} (${id})`;
		}
		return null;
	}

	/**
	 * Try to format using the entity type field value + id pattern
	 * Used as fallback when name field is not available
	 * @private
	 * @param entity - The entity object
	 * @returns Formatted string "entityTypeValue (id)" or null if either value is missing
	 * @example
	 * // For entityType "BillingCode":
	 * // Entity: { BillingCode: "Standard Rate", id: 456 }
	 * // Returns: "Standard Rate (456)"
	 */
	private formatEntityTypeName(entity: IDataObject): string | null {
		const displayValue = entity[this.entityType];
		const id = entity.id;
		if (displayValue !== undefined && displayValue !== null && id !== undefined && id !== null) {
			return `${displayValue} (${id})`;
		}
		return null;
	}

	/**
	 * Generate a fallback display name when no other format is possible
	 * Uses the fallback configuration to determine the format
	 * @private
	 * @param entity - The entity object
	 * @param fallbackConfig - Configuration for fallback behavior
	 * @returns A fallback display name string
	 * @example
	 * // With customLabel: { customLabel: "Custom Entity" } -> "Custom Entity"
	 * // With useId: { useId: true } -> "EntityType #123"
	 * // Default: "Unknown"
	 */
	private getFallbackName(entity: IDataObject, fallbackConfig: IFallbackConfig): string {
		if (fallbackConfig.customLabel) {
			return fallbackConfig.customLabel;
		}
		if (fallbackConfig.useId && entity.id !== undefined) {
			return `${this.entityType} #${entity.id}`;
		}
		return String(fallbackConfig.defaultValue || 'Unknown');
	}

	/**
	 * Format an entity's display name using a hierarchical approach:
	 * 1. Try configured mapping from PICKLIST_REFERENCE_FIELD_MAPPINGS
	 * 2. Try default name + id format
	 * 3. Try entityType + id format
	 * 4. Use fallback configuration
	 * @private
	 * @param entity - The entity object to format
	 * @param options - Display name formatting options
	 * @returns Formatted display name string
	 * @throws Error if no display name can be generated
	 */
	private formatDisplayName(entity: IDataObject, options: IDisplayNameOptions): string {
		const useMapping = options.useMapping ?? true;
		const fallbackConfig = {
			...this.fallbackConfig,
			...options.fallback,
		};

		// 1. Try to use field mapping if enabled and exists
		if (useMapping && PICKLIST_REFERENCE_FIELD_MAPPINGS[this.entityType]) {
			const mappedName = this.formatMappedName(entity, PICKLIST_REFERENCE_FIELD_MAPPINGS[this.entityType]);
			if (mappedName) return mappedName;
		}

		// 2. Try default name + id format
		const defaultName = this.formatDefaultName(entity);
		if (defaultName) return defaultName;

		// 3. Try entityType + id format
		const entityTypeName = this.formatEntityTypeName(entity);
		if (entityTypeName) return entityTypeName;

		// 4. Use fallback if enabled
		if (fallbackConfig.enabled) {
			return this.getFallbackName(entity, fallbackConfig);
		}

		throw new Error(`No display name found for ${this.entityType}`);
	}

	/**
	 * Reset helper state
	 */
	reset(): void {
		this.currentDepth = 0;
	}

	/**
	 * Get entity by ID
	 */
	public async getEntityById(id: string): Promise<T | undefined> {
		const results = await this.getValues();
		return results.find(entity => String(entity.id) === id);
	}
}
