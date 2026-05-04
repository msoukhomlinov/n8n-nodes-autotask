import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { getFields } from '../entity/api';
import type { IUdfFieldDefinition } from '../../types/base/udf-types';

/**
 * Build a POST body for create operations by moving UDF flat fields into
 * userDefinedFields:[{name,value}] format expected by the Autotask API.
 * The input createFields object is NOT mutated.
 *
 * Called by compound helpers (createIfNotExists) immediately before
 * autotaskApiRequest — after dedup/diff which reads createFields flat.
 * Mirrors the UDF handling in applyDuplicateUpdate for the create path.
 */
export async function buildApiCreateBody(
	ctx: IExecuteFunctions,
	entityName: string,
	createFields: Record<string, unknown>,
): Promise<IDataObject> {
	const body: IDataObject = { ...createFields as IDataObject };
	try {
		const udfDefs = await getFields(entityName, ctx, { fieldType: 'udf' }) as IUdfFieldDefinition[];
		if (udfDefs.length > 0) {
			const udfNameSet = new Set(udfDefs.map(u => u.name.toLowerCase()));
			const udfKeys = Object.keys(body).filter(k => udfNameSet.has(k.toLowerCase()));
			if (udfKeys.length > 0) {
				body.userDefinedFields = udfKeys.map(k => ({ name: k, value: body[k] }));
				for (const k of udfKeys) delete body[k];
			}
		}
	} catch {
		// UDF metadata unavailable — body sent as-is; API returns a field-level error
		// if any UDF fields reach the root body (more actionable than a pre-request throw).
	}
	return body;
}
