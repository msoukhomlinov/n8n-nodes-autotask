import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IContractCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ContractCreateOutcome = 'created' | 'skipped' | 'updated' | 'company_not_found';

export interface IContractCreateResult {
	outcome: ContractCreateOutcome;
	companyID: string | number;
	contractId?: number;
	existingContractId?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Field type map ──────────────────────────────────────────────────────────

/**
 * Known field types for contract dedup comparison.
 * Default is 'string' for any field not listed here.
 */
const CONTRACT_FIELD_TYPE_MAP: Record<string, string> = {
	contractName: 'string',
	contractNumber: 'string',
	externalServiceIdentifier: 'string',
	contractType: 'integer',
};

// ─── Step 1: Verify company exists ──────────────────────────────────────────

async function verifyCompanyExists(
	ctx: IExecuteFunctions,
	companyID: string | number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'Companies/query',
		{ filter: [{ field: 'id', op: 'eq', value: companyID }] },
	);

	const companies = extractItems(response as IDataObject);
	return companies.length > 0;
}

// ─── Step 2: Find duplicate contract ────────────────────────────────────────

async function findDuplicateContract(
	ctx: IExecuteFunctions,
	companyID: string | number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// Server-side filter: always scope by companyID, narrow by first dedup field if present
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: 'companyID', op: 'eq', value: companyID },
	];

	const firstDedupField = dedupFields[0];
	if (firstDedupField && createFields[firstDedupField] !== undefined) {
		apiFilter.push({
			field: firstDedupField,
			op: 'eq',
			value: createFields[firstDedupField],
		});
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'Contracts/query', { filter: apiFilter },
	);

	const contracts = extractItems(response as IDataObject);

	// Client-side precision match on ALL selected dedupFields
	for (const contract of contracts) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = CONTRACT_FIELD_TYPE_MAP[field] ?? 'string';
			const inputValue = createFields[field];
			const apiValue = contract[field];

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			return { duplicate: contract, matchedFields: matched };
		}
	}

	return { duplicate: null, matchedFields: [] };
}

// ─── Step 3: Create contract ─────────────────────────────────────────────────

async function createContract(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body: IDataObject = {
		...createFields as IDataObject,
	};

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Contracts',
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const contractId = extractId(response as IDataObject);
	if (!contractId) {
		throw new Error('Contract creation succeeded but returned no ID.');
	}
	return contractId;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createContractIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IContractCreateIfNotExistsOptions,
): Promise<IContractCreateResult> {
	const { createFields, dedupFields, errorOnDuplicate } = options;
	const warnings: string[] = [];

	const companyID = createFields.companyID as string | number | undefined;
	if (companyID === undefined || companyID === null) {
		throw new Error('createFields.companyID is required for contract.createIfNotExists');
	}

	// Step 1: Verify company exists
	const companyExists = await verifyCompanyExists(ctx, companyID);
	if (!companyExists) {
		return {
			outcome: 'company_not_found',
			companyID,
			reason: `Company with ID ${companyID} not found.`,
			warnings,
		};
	}

	// Step 2: Check for duplicate contract
	const { duplicate, matchedFields } = await findDuplicateContract(
		ctx, companyID, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate contract found (ID: ${duplicate.id}) for company ${companyID}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const { computeFieldDiffs, applyDuplicateUpdate } = await import('./update-fields-on-duplicate');
			const { patch, compared, skipped: _skipped, warnings: diffWarnings } = computeFieldDiffs(
				duplicate as Record<string, unknown>,
				createFields,
				updateFields,
				CONTRACT_FIELD_TYPE_MAP,
			);
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'Contract',
					duplicateId: duplicate.id as number,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					companyID,
					existingContractId: duplicate.id as number,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					companyID,
					existingContractId: duplicate.id as number,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			companyID,
			reason: 'duplicate_contract',
			existingContractId: duplicate.id as number,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Create contract
	const contractId = await createContract(
		ctx,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		companyID,
		contractId,
		warnings,
	};
}
