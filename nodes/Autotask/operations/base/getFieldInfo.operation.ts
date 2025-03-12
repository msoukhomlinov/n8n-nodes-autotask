import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { BaseOperation } from './base-operation';
import { OperationType } from '../../types/base/entity-types';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import type { IEntityField } from '../../types/base/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { getEntityInfo, getFields } from '../../helpers/entity/api';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';

/**
 * Operation to retrieve field information including standard and UDF fields
 */
export class GetFieldInfoOperation extends BaseOperation {
	constructor(
		entityType: string,
		context: IExecuteFunctions,
		parentType?: string,
		parentChain?: string[],
	) {
		super(entityType, OperationType.READ, context, parentType, parentChain);
	}

	/**
	 * Execute the operation
	 */
	public async execute(): Promise<INodeExecutionData> {
		return handleErrors(
			this.context,
			async () => {
				// Get entity metadata
				const metadata = getEntityMetadata(this.entityType);
				if (!metadata) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Entity metadata not found'),
					);
				}

				// Get entity info using cached function
				const entityInfo = await getEntityInfo(this.entityType, this.context);

				// Get standard fields using cached function
				const standardFieldsRaw = await getFields(this.entityType, this.context, { fieldType: 'standard' }) as IEntityField[];
				const standardFields = this.processStandardFields(standardFieldsRaw);

				// Get UDF fields if supported using cached function
				let udfFields: IEntityField[] = [];
				if (entityInfo.hasUserDefinedFields) {
					console.debug(`[${new Date().toISOString()}] Entity ${this.entityType} supports UDF fields, fetching UDF fields`);
					const udfFieldsRaw = await getFields(this.entityType, this.context, { fieldType: 'udf' }) as IUdfFieldDefinition[];
					udfFields = this.processUdfFields(udfFieldsRaw as unknown as IEntityField[]);
					console.debug(`[${new Date().toISOString()}] Retrieved ${udfFields.length} UDF fields for ${this.entityType}`);
				} else {
					console.debug(`[${new Date().toISOString()}] Entity ${this.entityType} does not support UDF fields (hasUserDefinedFields: ${entityInfo.hasUserDefinedFields})`);
				}

				// Combine all fields
				const allFields = [...standardFields, ...udfFields];

				// Build response
				const fieldInfo: IDataObject = {
					name: this.entityType,
					metadata: {
						...metadata,
						hasUserDefinedFields: entityInfo.hasUserDefinedFields,
						supportsWebhookCallouts: entityInfo.supportsWebhookCallouts,
					},
					standardFields,
					udfFields,
					allFields,
				};

				return {
					json: fieldInfo,
				};
			},
			{
				operation: 'getFieldInfo',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Process standard fields to add additional metadata
	 */
	private processStandardFields(fields: IEntityField[]): IEntityField[] {
		return fields.map(field => ({
			...field,
			isUdf: false,
			isSystemField: field.isSystemField || false,
		}));
	}

	/**
	 * Process UDF fields to match standard field format
	 */
	private processUdfFields(fields: IEntityField[]): IEntityField[] {
		return fields.map(field => ({
			...field,
			isUdf: true,
			isSystemField: false,
		}));
	}
}
