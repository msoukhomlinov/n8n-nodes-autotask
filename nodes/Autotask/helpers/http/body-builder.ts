import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';
import { getEntityMetadata } from '../../constants/entities';
import { getFields } from '../entity/api';

export interface IRequestBodyOptions {
	validatedData: IDataObject;
	entityType: string;
	entityId?: string | number;
	operation: 'create' | 'update';
	ctx: IExecuteFunctions;
	parentInfo?: {
		parentType: string;
		parentId: string | number;
	};
}

export interface IRequestBodyResult {
	body: IDataObject;
	hasUdfs: boolean;
	useId: boolean;
}

export async function buildRequestBody(options: IRequestBodyOptions): Promise<IRequestBodyResult> {
	const { validatedData, entityType, entityId, operation, ctx } = options;

	const metadata = getEntityMetadata(entityType);

	let hasUdfs = false;
	let udfFieldNames: string[] = [];

	const supportsUdfs = metadata?.hasUserDefinedFields === true;

	let udfFields: IUdfFieldDefinition[] = [];
	if (supportsUdfs) {
		try {
			udfFields = await getFields(entityType, ctx, { fieldType: 'udf' }) as IUdfFieldDefinition[];
		} catch {
			console.warn(`[buildRequestBody] Failed to fetch UDF definitions for '${entityType}' — body sent without UDF splitting.`);
		}
	}

	if (udfFields.length > 0) {
		udfFieldNames = Object.keys(validatedData).filter(key => {
			const lowerKey = key.toLowerCase();
			return udfFields.some(udf => udf.name.toLowerCase() === lowerKey);
		});
		hasUdfs = udfFieldNames.length > 0;
	}

	const useId = hasUdfs || !!metadata?.childOf;

	let body: IDataObject;
	if (hasUdfs) {
		const userDefinedFields = udfFieldNames.map(name => ({
			name,
			value: validatedData[name],
		}));
		const standardFields = Object.fromEntries(
			Object.entries(validatedData).filter(([key]) => !udfFieldNames.includes(key))
		);
		body = { ...standardFields, userDefinedFields };
	} else {
		body = { ...validatedData };
	}

	if (operation === 'update' && entityId !== undefined) {
		body.id = entityId;
	}

	if (operation === 'create' && useId) {
		body.id = 0;
	}

	if (metadata?.childOf && options.parentInfo) {
		const parentIdField = metadata.parentIdField || `${options.parentInfo.parentType}ID`;
		body[parentIdField] = options.parentInfo.parentId;
	}

	return { body, hasUdfs, useId };
}
