import type { IDataObject } from 'n8n-workflow';
import type { FieldProcessor } from '../../operations/base/field-processor';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import { getEntityMetadata } from '../../constants/entities';
import { getFields } from '../entity/api';
import { EntityHelper } from '../entity';

/**
 * Options for building a request body
 */
export interface IRequestBodyOptions {
	/** Validated field values */
	validatedData: IDataObject;
	/** Entity type being operated on */
	entityType: string;
	/** Entity ID for updates */
	entityId?: string | number;
	/** Operation type */
	operation: 'create' | 'update';
	/** Field processor instance */
	fieldProcessor: FieldProcessor;
	/** Parent entity information for child entities */
	parentInfo?: {
		parentType: string;
		parentId: string | number;
	};
}

/**
 * Result of request body building
 */
export interface IRequestBodyResult {
	/** The constructed request body */
	body: IDataObject;
	/** Whether the request contains UDF fields */
	hasUdfs: boolean;
	/** Whether to use 'id' instead of 'itemId' */
	useId: boolean;
}

/**
 * Builds a request body for create or update operations
 */
export async function buildRequestBody(options: IRequestBodyOptions): Promise<IRequestBodyResult> {
	const { validatedData, entityType, entityId, operation, fieldProcessor } = options;

	// Get entity metadata
	const metadata = getEntityMetadata(entityType);
	console.log('Debug: Entity metadata:', metadata);

	if (!fieldProcessor.context) {
		throw new Error('Context is required for field processing');
	}

	// Create EntityHelper instance
	const entityHelper = new EntityHelper(entityType, fieldProcessor.context);

	let hasUdfs = false;
	let udfFieldNames: string[] = [];

	// Check if entity supports UDFs before fetching
	const supportsUdfs = metadata?.hasUserDefinedFields === true;

	// Fetch UDF field definitions only for entities that support UDFs
	const udfFields = supportsUdfs
		? await getFields(entityType, entityHelper.context, { fieldType: 'udf' }) as IUdfFieldDefinition[]
		: [];

	// Get UDF field names from the validated data that match our UDF definitions
	if (udfFields.length > 0) {
		// Use case-insensitive matching for UDF field names
		udfFieldNames = Object.keys(validatedData).filter(key => {
			const lowerKey = key.toLowerCase();
			return udfFields.some(udf => udf.name.toLowerCase() === lowerKey);
		});

		hasUdfs = udfFieldNames.length > 0;

		if (hasUdfs) {
			console.debug(`[UdfDetection] Detected ${udfFieldNames.length} UDF fields in input data:`, udfFieldNames);
		}
	}

	// Always use 'id' for child entities and UDF updates
	const useId = hasUdfs || !!metadata?.childOf;

	// Construct request body based on whether we have UDFs
	let body: IDataObject;
	if (hasUdfs) {
		// Transform UDF fields into proper format
		const userDefinedFields = udfFieldNames.map(name => ({
			name,
			value: validatedData[name],
		}));

		// Remove UDF fields from root level
		const standardFields = Object.fromEntries(
			Object.entries(validatedData).filter(([key]) => !udfFieldNames.includes(key))
		);

		body = {
			...standardFields,
			userDefinedFields,
		};
	} else {
		body = { ...validatedData };
	}

	// Add ID for updates
	if (operation === 'update' && entityId !== undefined) {
		body.id = entityId;
	}

	// For creates, ensure we have an ID field set to 0 if using 'id'
	if (operation === 'create' && useId) {
		body.id = '0';
	}

	// Add parent ID if this is a child entity and parent info is provided
	if (metadata?.childOf && options.parentInfo) {
		const parentIdField = metadata.parentIdField || `${options.parentInfo.parentType}ID`;
		body[parentIdField] = options.parentInfo.parentId;
	}

	console.log('Debug: Request body:', body);

	return {
		body,
		hasUdfs,
		useId,
	};
}
