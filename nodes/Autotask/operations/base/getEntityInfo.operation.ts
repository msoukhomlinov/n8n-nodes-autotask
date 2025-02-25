import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { BaseOperation } from './base-operation';
import { OperationType } from '../../types/base/entity-types';
import { handleErrors } from '../../helpers/errorHandler';
import { getEntityMetadata } from '../../constants/entities';
import type { IAutotaskEntity } from '../../types/base/entity-types';
import type { IEntityInfo } from '../../types/base/entities';
import { ERROR_TEMPLATES } from '../../constants/error.constants';
import { buildEntityUrl } from '../../helpers/http/request';
import { autotaskApiRequest } from '../../helpers/http';

/**
 * Operation to retrieve entity metadata and information
 */
export class GetEntityInfoOperation<T extends IAutotaskEntity> extends BaseOperation {
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

				// Get entity definition from API
				const endpoint = buildEntityUrl(this.entityType);
				const apiResponse = await autotaskApiRequest.call(
					this.context,
					'GET',
					`${endpoint}/entityInformation`,
				) as { info: IEntityInfo };

				if (!apiResponse?.info) {
					throw new Error(
						ERROR_TEMPLATES.validation
							.replace('{type}', 'ValidationError')
							.replace('{entity}', this.entityType)
							.replace('{details}', 'Invalid entity info response format'),
					);
				}

				const apiInfo = apiResponse.info;

				// Combine metadata and API info
				const entityInfo: IDataObject = {
					name: this.entityType,
					metadata: {
						...metadata,
						supportedOperations: this.getSupportedOperations(apiInfo),
					},
					apiInfo,
				};

				return {
					json: entityInfo,
				};
			},
			{
				operation: 'getEntityInfo',
				entityType: this.entityType,
			},
		);
	}

	/**
	 * Get supported operations based on API info
	 */
	private getSupportedOperations(apiInfo: IEntityInfo): string[] {
		const operations: string[] = ['get', 'getMany', 'query'];

		if (apiInfo.canCreate) operations.push('create');
		if (apiInfo.canUpdate) operations.push('update');
		if (apiInfo.canDelete) operations.push('delete');
		if (apiInfo.hasUserDefinedFields) operations.push('udf');
		if (apiInfo.supportsWebhookCallouts) operations.push('webhook');

		return operations;
	}
}
