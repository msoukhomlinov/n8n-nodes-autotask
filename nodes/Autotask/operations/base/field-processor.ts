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

		// Load reference values for all fields
		return this.loadReferenceValues(entityFields);
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
		options: IProcessFieldsOptions = {},
	): Promise<IDataObject> {
		return await handleErrors(
			this.context as IExecuteFunctions,
			async () => {
				const data: IDataObject = {};
				// Cast context to the expected type (IExecuteFunctions or ILoadOptionsFunctions)
				const contextForTimezone = this.context as IExecuteFunctions | ILoadOptionsFunctions;
				const timezone = await getConfiguredTimezone.call(contextForTimezone);

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

			// For create operations, exclude read-only fields (except parent ID which was handled above)
			if (operation === 'create' && field.isReadOnly) {
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
}
