import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';
import { findDuplicate } from './entity-dedup';
import { performCreate } from './entity-writer';
import { ParentNotFoundError } from './compound-errors';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IContractServiceCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ContractServiceCreateOutcome = 'created' | 'skipped' | 'updated';

export interface IContractServiceCreateResult {
	outcome: ContractServiceCreateOutcome;
	contractId?: number;
	contractServiceId?: number;
	serviceID?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: Record<string, { from: unknown; to: unknown }>;
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

async function resolveContractId(
	ctx: IExecuteFunctions,
	contractID: string | number,
): Promise<{ contractId: number | null; warnings: string[] }> {
	const numericId = Number(contractID);
	const exists = await verifyContractExists(ctx, numericId);
	return { contractId: exists ? numericId : null, warnings: [] };
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
		throw new ParentNotFoundError('Contract', 'id', String(contractID));
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
			const { patch, fieldChanges, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
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
					contractServiceId: duplicate.id as number,
					serviceID,
					matchedDedupFields: matchedFields,
					fieldsUpdated: fieldChanges,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					contractId,
					contractServiceId: duplicate.id as number,
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
			contractServiceId: duplicate.id as number,
			serviceID,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Create ContractService
	const { id: contractServiceId, warnings: createWarnings } = await performCreate(
		ctx,
		'ContractService',
		{ ...createFields as IDataObject, contractID: contractId },
		{
			endpoint: `Contracts/${contractId}/Services`,
			impersonationResourceId: options.impersonationResourceId,
			proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied ?? true,
		},
	);
	warnings.push(...createWarnings);

	return {
		outcome: 'created',
		contractId,
		contractServiceId,
		serviceID,
		warnings,
	};
}
