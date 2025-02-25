import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { BaseOperation } from './base-operation';
import { OperationType } from '../../types/base/entity-types';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import type { IEntityField, IEntityInfo } from '../../types/base/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { buildEntityUrl } from '../../helpers/http/request';
import { autotaskApiRequest } from '../../helpers/http';

/**
 * Operation to retrieve field information including standard and UDF fields
 */
export class GetFieldInfoOperation<T extends IAutotaskEntity> extends BaseOperation {
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
	public async execute(itemIndex: number): Promise<INodeExecutionData> {
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

				// Get entity info first to check for UDF support
				const baseEndpoint = buildEntityUrl(this.entityType).replace(/\/$/, '');
				const entityInfoResponse = await autotaskApiRequest.call(
					this.context,
					'GET',
					`${baseEndpoint}/entityInformation`,
				) as { info: IEntityInfo };

				if (!entityInfoResponse?.info) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Invalid entity info response format'),
					);
				}

				const entityInfo = entityInfoResponse.info;

				// Get standard fields from API
				const standardFieldsResponse = await autotaskApiRequest.call(
					this.context,
					'GET',
					`${baseEndpoint}/entityInformation/fields`,
				) as { fields: IEntityField[] };

				// Process standard fields
				const standardFields = this.processStandardFields(standardFieldsResponse.fields || []);

				// Get UDF fields if supported
				let udfFields: IEntityField[] = [];
				if (entityInfo.hasUserDefinedFields) {
					console.debug(`[${new Date().toISOString()}] Entity ${this.entityType} supports UDF fields, fetching from: ${baseEndpoint}/entityInformation/userDefinedFields`);
					const udfResponse = await autotaskApiRequest.call(
						this.context,
						'GET',
						`${baseEndpoint}/entityInformation/userDefinedFields`,
					) as { fields: IEntityField[] };
					udfFields = this.processUdfFields(udfResponse.fields || []);
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
