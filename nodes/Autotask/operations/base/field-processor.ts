import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IHookFunctions,
	INodeProperties,
	INodePropertyOptions,
	NodePropertyTypes,
	IDataObject,
	NodeParameterValueType,
} from 'n8n-workflow';
import type { IAutotaskField, IEntityField, ResourceMapperField } from '../../types/base/entities';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import type { ResourceOperation } from '../../types/base/common';
import { OperationTypeValidator } from './operation-type';
import { FieldConversionPipeline } from '../../helpers/field-conversion/pipeline';
import { createDateWrapper } from '../../helpers/date-time/index';
import { sentenceCase } from 'change-case';
import { EntityValueHelper } from '../../helpers/entity-values';
import { REFERENCE_ENABLED_ENTITIES } from '../../constants/field.constants';
import type { ReferenceEnabledEntity } from '../../constants/field.constants';
import { fieldTypeService, mapFieldOptions, getFieldTypeOptions, getFieldDisplayType } from '../../helpers/field-conversion/utils';
import type { IFieldMappingContext } from '../../helpers/field-conversion/services/field-type.service';
import { handleErrors } from '../../helpers/errorHandler';
import { ERROR_TEMPLATES, WARNING_TEMPLATES } from '../../constants/error.constants';
import { getResourceMapperFieldType } from '../../helpers/field-conversion/utils';
import type { CacheService } from '../../helpers/cache/service';
import { initializeCache } from '../../helpers/cache/init';
import { sortPicklistValues } from '../../helpers/field-conversion/utils';
import { getEntityMetadata } from '../../constants/entities';
import { getConfiguredTimezone } from '../../helpers/date-time/utils';
import { getFields } from '../../helpers/entity/api';

export interface IProcessFieldsOptions {
	convertToProperties?: boolean;
	includeOptions?: boolean;
	mode?: 'read' | 'write';
	fieldType?: 'standard' | 'udf';
	parentType?: string;
	isChildEntity?: boolean;
}

export interface IFieldValueProcessingOptions extends IProcessFieldsOptions {
	itemIndex?: number;
	context?: IExecuteFunctions;
	initialValues?: IDataObject;
}

export interface IProcessedFields {
	fields: ResourceMapperField[];
	properties?: INodeProperties[];
	options?: INodePropertyOptions[];
}

/**
 * Handles field processing and configuration
 */
export class FieldProcessor {
	private readonly operationHandler: OperationTypeValidator;
	public readonly context?: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;
	private readonly entityType: string;
	private readonly pipeline: FieldConversionPipeline;
	private readonly _entityHelpers: Map<string, EntityValueHelper<IAutotaskEntity>>;
	private cacheService?: CacheService;

	// Instance management
	private static instances: Map<string, FieldProcessor> = new Map();

	/**
	 * Get instance key for the processor
	 * @private
	 */
	private static getInstanceKey(entityType: string, nodeId?: string): string {
		return `${entityType}_${nodeId || 'default'}`;
	}

	/**
	 * Get or create a FieldProcessor instance
	 * Uses entityType to maintain unique instances
	 */
	public static getInstance(
		entityType: string,
		operation: ResourceOperation,
		context?: IExecuteFunctions,
		options: IProcessFieldsOptions = {},
	): FieldProcessor {
		const nodeId = context?.getNode()?.id;
		const key = FieldProcessor.getInstanceKey(entityType, nodeId);

		if (!FieldProcessor.instances.has(key)) {
			FieldProcessor.instances.set(key, new FieldProcessor(entityType, context, options));
		}

		const instance = FieldProcessor.instances.get(key);
		if (!instance) {
			throw new Error(`Failed to get or create FieldProcessor instance for ${key}`);
		}
		return instance;
	}

	/**
	 * Clear instance for a specific configuration
	 * Used when node configuration changes
	 */
	public static clearInstance(entityType: string, nodeId?: string): void {
		const key = FieldProcessor.getInstanceKey(entityType, nodeId);
		FieldProcessor.instances.delete(key);
	}

	/**
	 * Clear all instances
	 * Used during cleanup or reset
	 */
	public static clearAllInstances(): void {
		FieldProcessor.instances.clear();
	}

	/**
	 * Private constructor to enforce singleton pattern
	 * @private
	 */
	private constructor(
		entityType: string,
		context?: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
		options: IProcessFieldsOptions = {},
	) {
		this.entityType = entityType;
		this.context = context;
		this.operationHandler = new OperationTypeValidator();
		this.pipeline = new FieldConversionPipeline(this);
		this._entityHelpers = new Map();

		// Check for parent relationship in metadata if not provided in options
		if (!options.parentType || !options.isChildEntity) {
			const metadata = getEntityMetadata(this.entityType);
			if (metadata?.childOf) {
				options.parentType = metadata.childOf;
				options.isChildEntity = true;
			}
		}

		// Initialize cache service if context is available
		if (context) {
			this.initializeCache().catch(error => {
				console.warn('Failed to initialize cache:', error);
			});
		}
	}

	/**
	 * Initialize the cache service with credentials
	 * @private
	 */
	private async initializeCache(): Promise<void> {
		if (!this.context) return;
		this.cacheService = await initializeCache(this.context);
	}

	/**
	 * Check if the current context is a LoadOptionsFunctions context
	 * Used to determine if we should skip expensive operations when just loading dropdown options
	 * @private
	 */
	private isLoadOptionsContext(): boolean {
		if (!this.context) return false;

		// IExecuteFunctions has getInputData and emit methods, ILoadOptionsFunctions doesn't
		const isExecuteContext = 'getInputData' in this.context || 'emit' in this.context;
		return !isExecuteContext;
	}

	/**
	 * Gets or creates an EntityValueHelper instance for the given entity type
	 * @private
	 */
	private getEntityValueHelper(entityType: string): EntityValueHelper<IAutotaskEntity> {
		if (!this._entityHelpers.has(entityType)) {
			this._entityHelpers.set(
				entityType,
				new EntityValueHelper<IAutotaskEntity>(
					this.context as unknown as ILoadOptionsFunctions,
					entityType,
					{
						cacheService: this.cacheService,
					}
				)
			);
		}
		const helper = this._entityHelpers.get(entityType);
		if (!helper) {
			throw new Error(`Failed to get or create EntityValueHelper for ${entityType}`);
		}
		return helper;
	}

	/**
	 * Unified field processing pipeline that handles all field-related operations
	 */
	public async processFields(
		fields: IEntityField[] | IAutotaskField[] | IUdfFieldDefinition[],
		operation: ResourceOperation,
		options: IProcessFieldsOptions = {},
	): Promise<IProcessedFields> {
		try {
			// Normalize fields to IEntityField[]
			const normalizedFields = await this.normalizeFields(fields, operation);

			// Filter fields based on operation
			const filteredFields = this.filterFieldsByOperation(normalizedFields, operation);

			// Convert fields using pipeline
			const convertedFields = await Promise.all(
				filteredFields.map(field =>
					this.pipeline.convertField(field, options.mode || 'write', operation)
				)
			);

			const result: IProcessedFields = {
				fields: convertedFields.filter((field): field is ResourceMapperField => field !== null),
			};

			// Convert to properties if requested
			if (options.convertToProperties) {
				result.properties = this.convertFieldsToProperties(result.fields, operation);
			}

			// Generate options if requested
			if (options.includeOptions) {
				result.options = this.generateFieldOptions(result.fields);
			}

			return result;
		} catch (error) {
			throw new Error(
				ERROR_TEMPLATES.operation
					.replace('{type}', 'ProcessingError')
					.replace('{operation}', 'processFields')
					.replace('{entity}', this.entityType)
					.replace('{details}', error instanceof Error ? error.message : 'Unknown error'),
			);
		}
	}

	/**
	 * Normalize different field types to IEntityField format
	 * @private
	 */
	private async normalizeFields(
		fields: IEntityField[] | IAutotaskField[] | IUdfFieldDefinition[],
		operation: ResourceOperation,
	): Promise<IEntityField[]> {
		// Handle empty fields array
		if (!fields?.length) {
			return [];
		}

		// Check if these are UDF fields by looking at the field properties
		const isUdfField = fields.some(field =>
			'udfType' in field ||
			'isUdf' in field ||
			(field as { isUserDefinedField?: boolean }).isUserDefinedField ||
			String(field.name).startsWith('UDF') ||
			'userDefinedFields' in field
		);

		if (isUdfField) {
			return this.convertUdfFields(fields as IUdfFieldDefinition[], operation);
		}

		// If not UDF, proceed with standard field type determination
		const isEntityField = fields[0] && 'label' in fields[0];

		// Convert to entity fields if needed
		const entityFields = isEntityField
			? fields as IEntityField[]
			: await this.convertToEntityFields(fields as IAutotaskField[]);

		// Check if we're in loadOptions context (populating dropdown options)
		// In this case, we should always load reference values to populate reference picklists
		if (this.isLoadOptionsContext()) {
			console.debug('[normalizeFields] In loadOptions context (resource mapper), loading reference values for picklists');
			return this.loadReferenceValues(entityFields);
		}

		// Only proceed with reference loading if not in loadOptions context
		// Check if 'Add Reference Labels' is enabled before loading reference values
		try {
			// Only attempt to get the parameter if we have a context
			if (this.context) {
				const itemIndex = 0; // Default to first item
				const addReferenceLabels = (this.context as IExecuteFunctions).getNodeParameter('addReferenceLabels', itemIndex, false) as boolean;

				// Only load reference values if enabled
				if (addReferenceLabels) {
					console.debug('[normalizeFields] "Add Reference Labels" is enabled, loading reference values');
					return this.loadReferenceValues(entityFields);
				}

				console.debug('[normalizeFields] "Add Reference Labels" is disabled, skipping reference value loading');
				return entityFields;
			}
		} catch (error) {
			// Parameter might not exist or we could be in a context where it can't be accessed
			console.debug('[normalizeFields] Could not determine "Add Reference Labels" setting, defaulting to no reference loading');
		}

		// Default path - don't load reference values
		return entityFields;
	}

	/**
	 * Formats a display name for a reference entity based on mapping configuration
	 * For entities without mapping, uses name field if available before falling back to ID
	 * Uses cached EntityValueHelper instances for better performance
	 */
	private formatReferenceDisplayName(entity: IDataObject, entityType: string): string {
		const helper = this.getEntityValueHelper(entityType);
		return helper.getEntityDisplayName(entity, { useMapping: true });
	}

	/**
	 * Loads reference values for fields that are references
	 * @private
	 */
	private async loadReferenceValues(fields: IEntityField[]): Promise<IEntityField[]> {
		if (!this.context) return fields;

		// Group reference fields by entity type
		const referenceFieldsByType = fields.reduce((acc, field) => {
			if (field.isReference &&
				field.referenceEntityType &&
				REFERENCE_ENABLED_ENTITIES.includes(field.referenceEntityType as ReferenceEnabledEntity)) {
				if (!acc[field.referenceEntityType]) {
					acc[field.referenceEntityType] = [];
				}
				acc[field.referenceEntityType].push(field);
			}
			return acc;
		}, {} as Record<string, IEntityField[]>);

		// Process each entity type once
		for (const [entityType, entityFields] of Object.entries(referenceFieldsByType)) {
			try {
				await handleErrors(
					this.context,
					async () => {
						// Try to get values from cache first
						let entities: IDataObject[] | undefined;
						const cacheKey = this.cacheService?.getReferenceKey(entityType);

						// Only attempt cache operations if we have both a cache service and a valid key
						if (this.cacheService?.isReferenceEnabled() && cacheKey) {
							console.debug(`[${new Date().toISOString()}] Attempting to load reference values from cache for entity '${entityType}' using key: ${cacheKey}`);
							entities = await this.cacheService.get<IDataObject[]>(cacheKey);

							// If not in cache, fetch from API
							if (!entities?.length) {
								console.debug(`[${new Date().toISOString()}] Cache miss for key '${cacheKey}' - fetching reference values from API for entity '${entityType}'`);
								entities = await this.getEntityValueHelper(entityType).getValues();

								// Cache the results if we have data
								if (entities?.length) {
									console.debug(`[${new Date().toISOString()}] Caching ${entities.length} reference values for entity '${entityType}' with key: ${cacheKey}`);
									await this.cacheService.set(
										cacheKey,
										entities,
										this.cacheService.getReferenceFieldTTL(),
									);
								}
							} else {
								console.debug(`[${new Date().toISOString()}] Cache HIT for key '${cacheKey}' - loaded ${entities.length} reference values for entity '${entityType}'`);
							}
						} else {
							// No cache available or invalid key, fetch directly from API
							console.debug(`[${new Date().toISOString()}] Cache not available for entity '${entityType}' - fetching from API`);
							entities = await this.getEntityValueHelper(entityType).getValues();
						}

						if (!entities?.length) {
							throw new Error(
								ERROR_TEMPLATES.reference
									.replace('{type}', 'NoDataError')
									.replace('{entity}', entityType)
									.replace('{details}', 'No reference values found')
							);
						}

						// Sort entities by display name
						const sortedEntities = sortPicklistValues(entities.map((entity, index) => ({
							...entity,
							label: this.formatReferenceDisplayName(entity as IDataObject, entityType),
							sortOrder: index,
							id: (entity as IDataObject).id,
						})));

						// Apply the sorted entities to all fields of this type
						for (const field of entityFields) {
							field.isPickList = true;
							field.picklistValues = sortedEntities.map(entity => ({
								value: String(entity.id || 0),
								label: entity.label,
								isDefaultValue: false,
								sortOrder: entity.sortOrder,
								isActive: (entity as IDataObject).isActive as boolean ?? true,
								isSystem: true,
							}));
						}
					},
					{
						operation: 'loadReference',
						entityType,
					}
				);
			} catch (error) {
				// Log warning and set fallback values
				console.warn(
					WARNING_TEMPLATES.reference
						.replace('{entity}', entityType)
						.replace('{details}', error instanceof Error ? error.message : 'Unknown error')
				);

				// Set empty picklist values for failed reference fields
				for (const field of entityFields) {
					field.isPickList = true;
					field.picklistValues = [];
					field.loadError = error instanceof Error ? error.message : 'Failed to load reference values';
				}
			}
		}

		return fields;
	}

	/**
	 * Convert API fields to entity fields
	 */
	private async convertToEntityFields(apiFields: IAutotaskField[]): Promise<IEntityField[]> {
		return Promise.resolve(apiFields.map(field => {
			// Get field type using centralized service
			const fieldType = getResourceMapperFieldType(field);

			return {
				...field,
				label: this.getFieldLabel(field.name),
				description: null,
				type: fieldType || 'string', // Fallback to string if type mapping fails
			};
		}));
	}

	/**
	 * Convert UDF fields to entity fields
	 * @private
	 */
	private convertUdfFields(udfFields: IUdfFieldDefinition[], operation: ResourceOperation): IEntityField[] {
		return udfFields.map(field => {
			// Get field type using centralized service
			const context: IFieldMappingContext = {
				mode: this.operationHandler.isWriteOperation(operation) ? 'write' : 'read',
				operation,
				entityType: this.entityType,
				isResourceMapper: true,
			};

			const fieldType = fieldTypeService.mapFieldType({
				...field,
				isReference: false,
				isPickList: field.isPickList || false,
			} as IAutotaskField, context);

			// Create entity field with all required properties
			return {
				...field,
				label: this.getFieldLabel(field.name),
				description: null,
				type: fieldType,
				typeOptions: getFieldTypeOptions({
					...field,
					isReference: false,
					isPickList: field.isPickList || false,
				} as IAutotaskField),
				options: mapFieldOptions({
					...field,
					isReference: false,
					isPickList: field.isPickList || false,
				} as IAutotaskField),
				isReference: false,
				isPickList: field.isPickList || false,
				dataType: field.dataType,
				isRequired: field.isRequired || false,
				isReadOnly: false,
				isQueryable: true,
				isSupportedWebhookField: true,
				isActive: true,
				isSystemField: false,
			};
		});
	}

	/**
	 * Process field values for API request
	 */
	async processFieldValues(
		initialValues: IDataObject,
		fields: IAutotaskField[],
		operation: ResourceOperation,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		options: IProcessFieldsOptions = {},
	): Promise<IDataObject> {
		// Use options parameter in future implementations if needed
		return await handleErrors(
			this.context as IExecuteFunctions,
			async () => {
				const data: IDataObject = {};
				// Cast context to the expected type (IExecuteFunctions or ILoadOptionsFunctions)
				const contextForTimezone = this.context as IExecuteFunctions | ILoadOptionsFunctions;
				const timezone = await getConfiguredTimezone.call(contextForTimezone);

				// Process fields based on options if needed in the future
				// Currently unused but kept for API consistency
				for (const field of fields) {
					// Skip if value is not explicitly set
					if (!(field.name in initialValues)) {
						console.debug(`[FieldProcessor] Skipping field ${field.name} - not in initialValues`);
						continue;
					}

					const value = initialValues[field.name];
					console.debug(`[FieldProcessor] Processing field ${field.name} with value:`, value);

					// Handle boolean fields that were converted to picklist
					if (typeof field.dataType === 'string' && field.dataType === 'boolean' && typeof value === 'string') {
						data[field.name] = value.toLowerCase() === 'true';
						console.debug(`[FieldProcessor] Converted boolean field ${field.name} to:`, data[field.name]);
						continue;
					}

					// Handle date/time fields
					if (typeof field.dataType === 'string' && (field.dataType === 'dateTime' || field.dataType === 'date')) {
						if (value === null) {
							data[field.name] = null;
							console.debug(`[FieldProcessor] Set null date for field ${field.name}`);
							continue;
						}

						const dateWrapper = createDateWrapper(value as string, `${field.name}`, field.dataType === 'dateTime');
						data[field.name] = dateWrapper.format(
							field.dataType === 'date' ? 'YYYY-MM-DD' : undefined,
							timezone,
						);
						console.debug(`[FieldProcessor] Formatted date field ${field.name} to:`, data[field.name]);
						continue;
					}

					// Include all values (including null and empty strings) for any field
					data[field.name] = value;
					console.debug(`[FieldProcessor] Set field ${field.name} to:`, value);
				}

				return data;
			},
			{
				operation: 'processFieldValues',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Filters fields based on operation type
	 * @private
	 */
	private filterFieldsByOperation(fields: IEntityField[], operation: ResourceOperation): IEntityField[] {
		const fieldType = fields.some(field =>
			'udfType' in field ||
			'isUdf' in field ||
			String(field.name).startsWith('UDF')
		) ? 'UDF' : 'standard';

		console.debug(`[FieldProcessor] Filtering ${fields.length} ${fieldType} fields for ${this.entityType}.${operation}`);

		if (!this.operationHandler.isWriteOperation(operation)) {
			return fields;
		}

		// Get metadata for this entity
		const metadata = getEntityMetadata(this.entityType);
		const parentIdField = metadata?.parentIdField || (metadata?.childOf ? `${metadata.childOf}ID` : undefined);

		if (metadata?.childOf) {
			console.debug(`[FieldProcessor] Entity ${this.entityType} is a child of ${metadata.childOf}, parent ID field: ${parentIdField}`);
		}

		// For write operations, handle update and create differently
		const filteredFields = fields.filter(field => {
			// Check if this is a parent ID field
			const isParentField = parentIdField && field.name.toLowerCase() === parentIdField.toLowerCase();
			if (isParentField) {
				console.debug(`[FieldProcessor] ✓ Field ${field.name} is the parent ID field (${parentIdField})`);
			}

			// Always include parent ID field for create operations if this is a child entity
			if (operation === 'create' && isParentField) {
				console.debug(`[FieldProcessor] Including parent ID field ${field.name} as required`);
				field.isRequired = true; // Set parent ID field as required for create operations
				field.isReadOnly = false; // Override read-only for parent ID fields in create operations
				return true;
			}

			// For update operations, exclude all read-only fields (even parent ID fields)
			if (operation === 'update' && field.isReadOnly) {
				console.debug(`[FieldProcessor] Excluding read-only field ${field.name} for update`);
				return false;
			}

			// For create operations, exclude read-only fields with special conditions
			if (operation === 'create' && field.isReadOnly) {
				// Always exclude 'id' field for create operations, even if it's marked as required
				if (field.name === 'id') {
					console.debug(`[FieldProcessor] Excluding read-only field ${field.name} for create`);
					return false;
				}

				// If the field is required, we should include it even if it's read-only
				if (field.isRequired) {
					console.debug(`[FieldProcessor] Including required read-only field ${field.name} for create`);
					return true;
				}

				console.debug(`[FieldProcessor] Excluding read-only field ${field.name} for create`);
				return false;
			}

			// Include all non-read-only fields
			return true;
		});

		console.debug(`[FieldProcessor] Filtered to ${filteredFields.length} fields for ${operation}`);
		return filteredFields;
	}

	/**
	 * Converts fields to node properties
	 * @private
	 */
	private convertFieldsToProperties(fields: ResourceMapperField[], operation: ResourceOperation): INodeProperties[] {
		return fields.map(field => {
			const context: IFieldMappingContext = {
				mode: this.operationHandler.isWriteOperation(operation) ? 'write' : 'read',
				operation,
				entityType: this.entityType,
				isResourceMapper: true,
			};

			const fieldType = fieldTypeService.mapFieldType(field, context);

			// Handle display type based on field type
			const displayType = 'dataType' in field && 'isReference' in field
				? getFieldDisplayType(field as unknown as IAutotaskField)
				: field.type;

			// Handle default value based on field type
			let defaultValue: NodeParameterValueType = null;
			if ('value' in field && field.value !== undefined) {
				if (typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean') {
					defaultValue = field.value;
				} else if (Array.isArray(field.value)) {
					defaultValue = field.value;
				}
			}

			// Check if field is required for this operation
			const isRequired = field.required;

			console.debug(`[FieldProcessor] Converting field ${field.name} to property, required=${isRequired}`);

			return {
				displayName: `${field.label} (${displayType})`,
				name: field.name,
				type: fieldType as NodePropertyTypes,
				default: defaultValue,
				description: field.description || undefined,
				required: isRequired,
				typeOptions: getFieldTypeOptions(field),
				options: mapFieldOptions(field),
			};
		});
	}

	/**
	 * Generates field options for resource mapper
	 * @private
	 */
	private generateFieldOptions(fields: ResourceMapperField[]): INodePropertyOptions[] {
		return fields.map(field => ({
			name: field.displayName,
			value: field.id,
		}));
	}

	/**
	 * Converts a camelCase field name to a human-readable label
	 */
	public getFieldLabel(name: string): string {
		// Handle ID suffix specially
		const withoutID = name.endsWith('ID') ? name.slice(0, -2) : name;

		// Convert to sentence case and handle special cases
		let label = sentenceCase(withoutID);

		// Add back ID suffix if it was present
		if (name.endsWith('ID')) {
			label += ' ID';
		}

		return label;
	}

	/**
	 * Get the entity type for this processor
	 */
	public getEntityType(): string {
		return this.entityType;
	}

	/**
	 * Enriches entities with picklist labels
	 * Adds a field with suffix "_label" for each picklist field containing the human-readable label
	 * Only processes standard picklist fields, not reference fields
	 */
	public async enrichWithPicklistLabels<T extends IAutotaskEntity | IDataObject>(
		entities: T | T[],
	): Promise<T | T[]> {
		// Handle single entity case
		if (!Array.isArray(entities)) {
			const result = await this.enrichWithPicklistLabels([entities]) as T[];
			return result[0];
		}

		// If no entities to process, return early
		if (entities.length === 0) {
			return entities;
		}

		if (!this.context) {
			throw new Error('Context is required for enrichWithPicklistLabels');
		}

		return await handleErrors(
			this.context as IExecuteFunctions,
			async () => {
				// Get both standard and UDF fields for this entity type
				const [standardFields, udfFields] = await Promise.all([
					this.getFieldsForEntity(this.entityType, 'standard'),
					this.getFieldsForEntity(this.entityType, 'udf')
				]);

				// Combine standard and UDF fields
				const allFields = [...standardFields, ...udfFields];

				// Filter for picklist fields that are not references
				const picklistFields = allFields.filter(field =>
					field.isPickList === true && field.isReference !== true
				);

				if (picklistFields.length === 0) {
					return entities;
				}

				// Create a map of fieldName -> picklistValues
				const fieldPicklistValuesMap = new Map<string, Array<{
					value: string;
					label: string;
					isDefaultValue: boolean;
					sortOrder: number;
					isActive: boolean;
				}>>();

				// Extract picklist values from fields
				for (const field of picklistFields) {
					if (field.picklistValues?.length) {
						fieldPicklistValuesMap.set(field.name, field.picklistValues);
					} else {
						// If field doesn't have picklist values, try to get them from the EntityValueHelper
						// This is a fallback and should rarely be needed since fields should already have picklist values
						try {
							const entityHelper = this.getEntityHelperInstance();
							const picklistValues = await entityHelper.getPicklistValues(field.name);
							if (picklistValues.length) {
								fieldPicklistValuesMap.set(field.name, picklistValues);
							}
						} catch (error) {
							console.warn(`[FieldProcessor] Failed to get picklist values for ${field.name}: ${error.message}`);
						}
					}
				}

				// Process each picklist field
				for (const field of picklistFields) {
					const fieldName = field.name;

					// Get picklist values for this field from the map
					const picklistValues = fieldPicklistValuesMap.get(fieldName) || [];

					if (!picklistValues.length) {
						continue;
					}

					// Create maps for different types of lookups
					const valueToLabelMap = new Map<string, string>();
					const valueToLabelMapLowerCase = new Map<string, string>();

					for (const value of picklistValues) {
						const stringValue = String(value.value);
						valueToLabelMap.set(stringValue, value.label);
						valueToLabelMapLowerCase.set(stringValue.toLowerCase(), value.label);
					}

					// Process each entity
					for (let i = 0; i < entities.length; i++) {
						const entity = entities[i];
						const fieldValue = entity[fieldName];

						// Skip if field doesn't exist or is null/undefined
						if (fieldValue === undefined || fieldValue === null) {
							continue;
						}

						// Convert field value to string for comparison
						const stringFieldValue = String(fieldValue);

						// Add the label field with suffix "_label"
						const labelFieldName = `${fieldName}_label`;

						// Try exact match first
						let label = valueToLabelMap.get(stringFieldValue);

						// If no exact match, try case-insensitive match
						if (!label) {
							label = valueToLabelMapLowerCase.get(stringFieldValue.toLowerCase());
						}

						// If still no match, try numeric comparison if the field value is numeric
						if (!label && !Number.isNaN(Number(stringFieldValue))) {
							const numericFieldValue = Number(stringFieldValue);
							for (const [key, val] of valueToLabelMap.entries()) {
								if (Number(key) === numericFieldValue) {
									label = val;
									break;
								}
							}
						}

						if (label) {
							// Create a new object with the label field inserted right after the original field
							const newEntity: IDataObject = {};
							let inserted = false;

							// Copy all properties in order, inserting the label field after its associated field
							for (const key of Object.keys(entity)) {
								newEntity[key] = entity[key];

								// Insert the label field right after its associated field
								if (key === fieldName) {
									newEntity[labelFieldName] = label;
									inserted = true;
								}
							}

							// If the field wasn't found (unlikely), add the label at the end
							if (!inserted) {
								newEntity[labelFieldName] = label;
							}

							// Replace the original entity with the new one
							entities[i] = newEntity as T;
						} else {
							console.warn(`[FieldProcessor] No label found for value "${stringFieldValue}" in field ${fieldName}`);
						}
					}
				}

				return entities;
			},
			{
				operation: 'enrichWithPicklistLabels',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Enriches entities with reference labels by adding fields with "_label" suffix
	 * containing human-readable values for reference fields.
	 * @param entities Entity or array of entities to enrich
	 * @returns Enriched entity or array of entities
	 */
	public async enrichWithReferenceLabels<T extends IAutotaskEntity | IDataObject>(
		entities: T | T[],
	): Promise<T | T[]> {
		// Handle single entity case
		if (!Array.isArray(entities)) {
			const result = await this.enrichWithReferenceLabels([entities]) as T[];
			return result[0];
		}

		// If no entities to process, return early
		if (entities.length === 0) {
			return entities;
		}

		if (!this.context) {
			throw new Error('Context is required for enrichWithReferenceLabels');
		}

		return await handleErrors(
			this.context as IExecuteFunctions,
			async () => {
				// Get all fields for this entity type
				const fields = await this.getFieldsForEntity(this.entityType, 'standard');

				// Filter for reference fields
				const referenceFields = fields.filter(field => field.isReference === true);

				if (referenceFields.length === 0) {
					return entities;
				}

				// Group reference fields by entity type for efficient batch loading
				const referenceFieldsByType = referenceFields.reduce((acc, field) => {
					if (field.referenceEntityType &&
						REFERENCE_ENABLED_ENTITIES.includes(field.referenceEntityType as ReferenceEnabledEntity)) {
						if (!acc[field.referenceEntityType]) {
							acc[field.referenceEntityType] = [];
						}
						acc[field.referenceEntityType].push(field);
					}
					return acc;
				}, {} as Record<string, IAutotaskField[]>);

				// Process each entity type's reference fields
				for (const [referenceEntityType, fields] of Object.entries(referenceFieldsByType)) {
					// Create a set of unique IDs referenced by all entities for this entity type
					const referenceIds = new Set<string | number>();

					// Collect all reference IDs from entities
					for (const entity of entities) {
						for (const field of fields) {
							const fieldName = field.name;
							const fieldValue = entity[fieldName];

							// Skip null/undefined values and ensure we only process string or number IDs
							if (fieldValue !== undefined && fieldValue !== null &&
								(typeof fieldValue === 'string' || typeof fieldValue === 'number')) {
								referenceIds.add(fieldValue);
							}
						}
					}

					// If no reference IDs found, skip this entity type
					if (referenceIds.size === 0) {
						continue;
					}

					// Load referenced entities
					console.debug(`[FieldProcessor] Loading ${referenceIds.size} references for ${referenceEntityType}`);

					// Get the entity helper for this reference type
					const entityHelper = this.getEntityValueHelper(referenceEntityType);

					// Get all entities for this type first
					const allEntities = await entityHelper.getValues();

					// Create a map of ID -> entity for quick lookups
					const entityMap = new Map<string | number, IDataObject>();

					// Add all entities to the map, with string keys for case-insensitive lookups
					for (const entity of allEntities) {
						if (entity.id !== undefined) {
							entityMap.set(entity.id, entity);
							// Also add a string version of the ID for string comparison
							entityMap.set(String(entity.id), entity);
						}
					}

					// Process each field for this entity type
					for (const field of fields) {
						const fieldName = field.name;

						// Process each entity
						for (let i = 0; i < entities.length; i++) {
							const entity = entities[i];
							const fieldValue = entity[fieldName];

							// Skip null/undefined values and ensure we only process string or number values
							if (fieldValue === undefined || fieldValue === null ||
								(typeof fieldValue !== 'string' && typeof fieldValue !== 'number')) {
								continue;
							}

							// Get the referenced entity - try both as is and as string
							const referenceId = fieldValue;
							let referencedEntity = entityMap.get(referenceId);

							// If not found directly, try string conversion
							if (!referencedEntity && typeof referenceId === 'number') {
								referencedEntity = entityMap.get(String(referenceId));
							}

							// Create the label field name with suffix "_label"
							const labelFieldName = `${fieldName}_label`;

							// If referenced entity exists, format its display name
							let label: string | undefined;
							if (referencedEntity) {
								label = this.formatReferenceDisplayName(referencedEntity, referenceEntityType);
							} else {
								console.warn(`[FieldProcessor] Reference entity not found for ${referenceEntityType} with ID ${referenceId}`);
								// Fallback to showing just the ID
								label = `${referenceEntityType} #${referenceId}`;
							}

							if (label) {
								// Create a new object with the label field inserted right after the original field
								const newEntity: IDataObject = {};
								let inserted = false;

								// Copy all properties in order, inserting the label field after its associated field
								for (const key of Object.keys(entity)) {
									newEntity[key] = entity[key];

									// Insert the label field right after its associated field
									if (key === fieldName) {
										newEntity[labelFieldName] = label;
										inserted = true;
									}
								}

								// If the field wasn't found (unlikely), add the label at the end
								if (!inserted) {
									newEntity[labelFieldName] = label;
								}

								// Replace the original entity with the new one
								entities[i] = newEntity as T;
							} else {
								console.warn(`[FieldProcessor] Failed to create label for ${referenceEntityType} with ID ${referenceId}`);
							}
						}
					}
				}

				return entities;
			},
			{
				operation: 'enrichWithReferenceLabels',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Get fields for an entity type
	 * @private
	 */
	private async getFieldsForEntity(entityType: string, fieldType: 'standard' | 'udf' = 'standard'): Promise<IAutotaskField[]> {
		if (!this.context) {
			throw new Error('Context is required for getFieldsForEntity');
		}

		// Use the context object directly
		return await getFields(entityType, this.context, { fieldType }) as IAutotaskField[];
	}

	/**
	 * Get an EntityHelper instance for an entity type
	 * @private
	 */
	private getEntityHelperInstance(): EntityValueHelper<IAutotaskEntity> {
		if (!this.context) {
			throw new Error('Context is required for getEntityHelperInstance');
		}

		if (!this._entityHelpers.has(this.entityType)) {
			this._entityHelpers.set(
				this.entityType,
				new EntityValueHelper<IAutotaskEntity>(
					this.context as IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
					this.entityType,
					{ cacheService: this.cacheService }
				),
			);
		}
		const helper = this._entityHelpers.get(this.entityType);
		if (!helper) {
			throw new Error(`Failed to get EntityHelper for ${this.entityType}`);
		}
		return helper;
	}
}
