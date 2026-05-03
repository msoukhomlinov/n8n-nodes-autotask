import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';
import { findDuplicate } from './entity-dedup';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IContractServiceCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ContractServiceCreateOutcome = 'created' | 'skipped' | 'updated' | 'contract_not_found';

export interface IContractServiceCreateResult {
	outcome: ContractServiceCreateOutcome;
	contractId?: number;
	contractServiceId?: number;
	existingContractServiceId?: number;
	serviceID?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

const CONTRACT_SERVICE_FIELD_TYPE_MAP: Record<string, string> = {
	serviceID: 'integer',
};

// ─── Step 0: Verify contract exists ─────────────────────────────────────────

async function verifyContractExists(
	ctx: IExecuteFunctions,
	contractId: number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Contracts/query',
		{ filter: [{ field: 'id', op: 'eq', value: contractId }] },
	);

	const contracts = extractItems(response as IDataObject);
	return contracts.length > 0;
}

// ─── Step 1: Resolve contractID ──────────────────────────────────────────────

/**
 * Resolve the contractID option to a numeric Autotask contract ID.
 * - If the value is already numeric (or a string of only digits), use it directly
 *   and verify the contract exists.
 * - Otherwise treat it as an externalServiceIdentifier and query Contracts/query.
 */
async function resolveContractId(
	ctx: IExecuteFunctions,
	contractID: string | number,
): Promise<{ contractId: number | null; warnings: string[] }> {
	const warnings: string[] = [];
	const isNumericId = typeof contractID === 'number' || (typeof contractID === 'string' && /^\d+$/.test(contractID) && parseInt(contractID, 10) > 0);

	if (isNumericId) {
		const numericId = Number(contractID);
		const exists = await verifyContractExists(ctx, numericId);
		if (!exists) {
			return { contractId: null, warnings };
		}
		return { contractId: numericId, warnings };
	}

	// Lookup by externalServiceIdentifier
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Contracts/query',
		{ filter: [{ field: 'externalServiceIdentifier', op: 'eq', value: String(contractID) }] },
	);

	const contracts = extractItems(response as IDataObject);

	if (contracts.length === 0) {
		return { contractId: null, warnings };
	}

	if (contracts.length > 1) {
		warnings.push(
			`Multiple Contracts (${contracts.length}) found for externalServiceIdentifier '${contractID}'. Using first (ID: ${contracts[0]?.id}).`,
		);
	}

	return { contractId: contracts[0].id as number, warnings };
}

// ─── Step 2: Find duplicate ContractService ──────────────────────────────────

function findDuplicateContractService(
	ctx: IExecuteFunctions,
	contractId: number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	return findDuplicate(ctx, {
		entityType: 'ContractService',
		queryEndpoint: 'ContractServices/query',
		scopeFilters: [{ field: 'contractID', op: 'eq', value: contractId }],
		dedupFields,
		createFields,
		fieldTypeMap: CONTRACT_SERVICE_FIELD_TYPE_MAP,
	});
}

// ─── Step 3: Create ContractService ──────────────────────────────────────────

/**
 * POST Contracts/{contractId}/Services to create a new ContractService record.
 */
async function createContractService(
	ctx: IExecuteFunctions,
	contractId: number,
	createFields: Record<string, unknown>,
	impersonationResourceId?: number,
	proceedWithoutImpersonationIfDenied?: boolean,
): Promise<number> {
	const body: IDataObject = {
		...createFields as IDataObject,
		contractID: contractId,
	};

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		`Contracts/${contractId}/Services`,
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const contractServiceId = extractId(response as IDataObject);
	if (!contractServiceId) {
		throw new Error('ContractService creation succeeded but returned no ID.');
	}

	return contractServiceId;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createContractServiceIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IContractServiceCreateIfNotExistsOptions,
): Promise<IContractServiceCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const contractID = createFields.contractID as string | number | undefined;
	if (contractID === undefined || contractID === null) {
		throw new Error('createFields.contractID is required for contractService.createIfNotExists');
	}

	const serviceID = createFields.serviceID as number | undefined;

	// Step 1: Resolve contractID
	const { contractId, warnings: resolveWarnings } = await resolveContractId(ctx, contractID);
	warnings.push(...resolveWarnings);

	if (contractId === null) {
		return {
			outcome: 'contract_not_found',
			serviceID,
			warnings,
		};
	}

	// Step 2: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateContractService(
		ctx, contractId, dedupFields, createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate ContractService found (ID: ${duplicate.id}) on Contract ${contractId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const { patch, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
				duplicate as Record<string, unknown>,
				createFields,
				updateFields,
				CONTRACT_SERVICE_FIELD_TYPE_MAP,
			);
			if (skipped.length > 0) {
				diffWarnings.push(`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`);
			}
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'ContractService',
					duplicateId: duplicate.id as number,
					parentId: contractId,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					contractId,
					existingContractServiceId: duplicate.id as number,
					serviceID,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					contractId,
					existingContractServiceId: duplicate.id as number,
					serviceID,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_contract_service',
			contractId,
			existingContractServiceId: duplicate.id as number,
			serviceID,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Create ContractService
	const contractServiceId = await createContractService(
		ctx,
		contractId,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		contractId,
		contractServiceId,
		serviceID,
		warnings,
	};
}
