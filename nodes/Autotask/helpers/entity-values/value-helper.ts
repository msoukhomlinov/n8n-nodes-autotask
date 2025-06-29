import type { ILoadOptionsFunctions, IExecuteFunctions, IDataObject, IHookFunctions } from 'n8n-workflow';
import type { IAutotaskEntity, IAutotaskQueryInput } from '../../types';
import type { GetManyOperation } from '../../operations/base/get-many';
import { GetManyOperation as GetManyOperationClass } from '../../operations/base/get-many';
import { PICKLIST_REFERENCE_FIELD_MAPPINGS, DEFAULT_PICKLIST_FIELDS } from '../../constants/field.constants';
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

		// Only use cache if the service exists and is enabled
		const cacheEnabled = this.cacheService?.isPicklistEnabled() ?? false;

		if (this.cacheService && cacheEnabled) {
			const cacheKey = this.cacheService.getPicklistKey(this.entityType, fieldName);
			values = await this.cacheService.get<Array<{
				value: string;
				label: string;
				isDefaultValue: boolean;
				sortOrder: number;
				isActive: boolean;
			}>>(cacheKey);
		}

		// If not in cache or cache disabled, fetch from API
		if (!values) {
			values = await this.entityHelper.getPicklistValues(fieldName);

			// Cache the results if caching is enabled
			if (cacheEnabled && this.cacheService) {
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
	 * Retrieve entities for pick-list / reference purposes.
	 *
	 * @param activeOnly When true (default) adds an `isActive=true` filter if the
	 *                   entity supports it.  For reference-label enrichment we
	 *                   pass `false` so labels can still be generated for IDs
	 *                   that point to inactive (historical) records.
	 */
	public async getValues(activeOnly = true): Promise<T[]> {
		try {
			// Apply any configured filters from PICKLIST_REFERENCE_FIELD_MAPPINGS
			const mapping = PICKLIST_REFERENCE_FIELD_MAPPINGS[this.entityType];
			const filters: Record<string, unknown> = {
				...(mapping?.filters || {}),
			};

			if (activeOnly && !('isActive' in filters)) {
				filters.isActive = true;
			}

			// Create query with filters
			const query: IAutotaskQueryInput<T> = {
				filter: Object.entries(filters).map(([field, value]) => ({
					field,
					op: 'eq',
					value: String(value),
				})),
			};

			// Debug: log the full query body for deeper troubleshooting, especially for Country look-ups
			if (this.entityType.toLowerCase() === 'country') {
				console.debug('[CountryLookup] Query filters:', JSON.stringify(filters));
			}

			console.debug(`Loading reference values for ${this.entityType} with filters:`, filters);

			// Get entities with filters applied
			const results = await this.getManyOperation.execute(query);

			// Extra debug for Country reference resolution
			if (this.entityType.toLowerCase() === 'country') {
				const sample = results.slice(0, 5).map(c => {
					const obj = c as unknown as IDataObject;
					return { id: obj.id, code: obj.countryCode, name: obj.displayName };
				});
				console.debug(`[CountryLookup] Retrieved ${results.length} rows. Sample:`, sample);
			}

			return results;
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
		maxResults = 20000,
		options?: {
			includeFields?: string[];
		}
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
			return await this.fetchValues(filters, sortField, maxResults, options);
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
		maxResults = 20000,
		options?: {
			includeFields?: string[];
		}
	): Promise<T[]> {
		// Add isActive=true to default filters
		const defaultFilters = {
			isActive: true,
			...filters, // Allow overriding default filters if needed
		};
		const query = await this.prepareQuery(defaultFilters, sortField, options?.includeFields);
		return await this.getManyOperation.execute(query, maxResults);
	}

	/**
	 * Get required fields for display name formatting based on entity type mapping
	 *
	 * This method is a critical part of the fix for the reference field enrichment issue.
	 * It ensures that when fetching reference entities for label generation, we always include
	 * the fields needed to construct display labels (like firstName, lastName for Resources),
	 * regardless of what columns the user has selected in their main query via IncludeFields.
	 *
	 * Note: We avoid including fields with certain patterns (like *ResourceID or *ID)
	 * that might cause API errors.
	 *
	 * Without these fields, reference labels cannot be properly formatted when column filtering is used.
	 *
	 * @private
	 * @returns Array of field names that must be included in API requests
	 */
	private getRequiredDisplayFields(): string[] {
		// Always include id field
		const requiredFields = new Set<string>(['id']);

		// Get mapping for this entity type
		const mapping = PICKLIST_REFERENCE_FIELD_MAPPINGS[this.entityType];

		if (mapping) {
			// Add name fields from mapping, filtering out potentially problematic fields
			for (const field of mapping.nameFields) {
				if (!field.endsWith('ID') && !field.endsWith('ResourceID')) {
					requiredFields.add(field);
				}
			}

			// Add bracket fields if any, filtering out potentially problematic fields
			if (mapping.bracketField) {
				for (const field of mapping.bracketField) {
					if (!field.endsWith('ID') && !field.endsWith('ResourceID')) {
						requiredFields.add(field);
					}
				}
			}
		} else {
			// No mapping, use default fields, but still filter out problematic fields
			for (const field of DEFAULT_PICKLIST_FIELDS) {
				if (field === 'id' || (!field.endsWith('ID') && !field.endsWith('ResourceID'))) {
					requiredFields.add(field);
				}
			}
		}

		// Log which fields we're including
		const fieldArray = Array.from(requiredFields);
		console.debug(`[EntityValueHelper] Required display fields for ${this.entityType}: ${fieldArray.join(', ')}`);

		return fieldArray;
	}

	/**
	 * Prepare query input for API request
	 *
	 * This method handles two distinct use cases:
	 * 1. Regular entity queries - These might use column filtering via IncludeFields to optimize response size
	 * 2. Reference field lookups - When we're looking up entities for reference field enrichment
	 *
	 * For reference field lookups, we deliberately DO NOT filter fields (no IncludeFields parameter).
	 * This is essential because:
	 * - We need all fields to properly generate labels that might use various field combinations
	 * - Filtering could cause missing fields needed for label generation
	 * - Some field names might be invalid and cause API errors (500 status codes)
	 * - Reference lookups typically fetch a small number of entities, so bandwidth impact is minimal
	 *
	 * Regular queries can still use field filtering for optimization.
	 *
	 * @private
	 */
	private async prepareQuery(
		userFilters: Record<string, unknown>,
		sortField?: string,
		additionalFields?: string[]
	): Promise<IAutotaskQueryInput<T>> {
		const query: IAutotaskQueryInput<T> = {
			filter: [],
			IncludeFields: [],
		};

		// Add user filters
		for (const [field, value] of Object.entries(userFilters)) {
			if (value !== undefined && value !== null) {
				if (field === 'id' && typeof value === 'object' && value !== null && '$in' in value) {
					// Handle $in operator for id field
					query.filter.push({
						field,
						op: 'in',
						value: String((value as { $in: string | string[] }).$in),
					});
				} else {
					query.filter.push({
						field,
						op: 'eq',
						value: String(value),
					});
				}
			}
		}

		// For reference field lookups, we should not filter fields
		// We need to return all fields to ensure proper label construction
		// Only apply IncludeFields when this is not a reference field lookup
		const isReferenceFieldLookup = userFilters.id && typeof userFilters.id === 'object' &&
			userFilters.id !== null && '$in' in userFilters.id;

		if (!isReferenceFieldLookup) {
			// Initialize IncludeFields
			const includeFields = new Set<string>();

			// Add sort field if specified
			if (sortField) {
				includeFields.add(sortField);
			}

			// Add fields required for display name formatting
			for (const field of this.getRequiredDisplayFields()) {
				includeFields.add(field);
			}

			// Add any additional fields
			if (additionalFields && additionalFields.length > 0) {
				for (const field of additionalFields) {
					includeFields.add(field);
				}
			}

			// Set IncludeFields in query
			if (includeFields.size > 0) {
				query.IncludeFields = Array.from(includeFields);
				console.debug(`[EntityValueHelper] Including ${query.IncludeFields.length} fields for ${this.entityType} query`);
			}
		} else {
			// When doing reference field lookups, return all fields
			console.debug(`[EntityValueHelper] Reference field lookup detected for ${this.entityType} - returning all fields`);
			// IMPORTANT: Delete IncludeFields completely instead of setting to empty array
			// to avoid API errors with invalid field names
			query.IncludeFields = undefined;
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
