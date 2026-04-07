import type { IExecuteFunctions } from 'n8n-workflow';
import {
	createChargeIfNotExists,
	type IChargeCreateIfNotExistsOptions,
	type ChargeCreatorConfig,
	type IChargeCreateResult,
} from './charge-creator-base';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type IContractChargeCreateIfNotExistsOptions = IChargeCreateIfNotExistsOptions;

export type ContractChargeCreateIfNotExistsOutcome = 'created' | 'skipped' | 'updated' | 'contract_not_found';

export interface IContractChargeCreateIfNotExistsResult {
	outcome: ContractChargeCreateIfNotExistsOutcome;
	contractId?: number;
	chargeId?: number;
	existingChargeId?: number;
	externalServiceIdentifier: string;
	chargeName: string;
	datePurchased: string;
	unitQuantity?: number;
	unitPrice?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const CONTRACT_CHARGE_CONFIG: ChargeCreatorConfig = {
	parentEntityLabel: 'Contract',
	parentQueryEndpoint: 'Contracts/query',
	parentLookupField: 'externalServiceIdentifier',
	chargeQueryEndpoint: 'ContractCharges/query',
	chargeParentIdField: 'contractID',
	chargeCreateEndpointTemplate: 'Contracts/{parentId}/Charges',
	entityName: 'ContractCharge',
	fieldTypeMap: {
		name: 'string',
		datePurchased: 'datetime',
		unitQuantity: 'double',
		unitCost: 'double',
		unitPrice: 'double',
	},
};

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createContractChargeIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IContractChargeCreateIfNotExistsOptions,
): Promise<IContractChargeCreateIfNotExistsResult> {
	const externalServiceIdentifier = (options.createFields.externalServiceIdentifier as string) ?? '';
	if (!externalServiceIdentifier) {
		throw new Error('externalServiceIdentifier is required to find the contract.');
	}

	const result = await createChargeIfNotExists(
		ctx,
		CONTRACT_CHARGE_CONFIG,
		externalServiceIdentifier,
		options,
	);

	return mapToContractChargeResult(result, externalServiceIdentifier);
}

// ─── Result mapper ──────────────────────────────────────────────────────────

function mapToContractChargeResult(
	result: IChargeCreateResult,
	externalServiceIdentifier: string,
): IContractChargeCreateIfNotExistsResult {
	const outcome = result.outcome === 'parent_not_found'
		? 'contract_not_found' as const
		: result.outcome;

	return {
		outcome,
		contractId: result.parentId,
		chargeId: result.chargeId,
		existingChargeId: result.existingChargeId,
		externalServiceIdentifier,
		chargeName: result.chargeName,
		datePurchased: result.datePurchased,
		unitQuantity: result.unitQuantity,
		unitPrice: result.unitPrice,
		reason: result.reason,
		matchedDedupFields: result.matchedDedupFields,
		fieldsUpdated: result.fieldsUpdated,
		fieldsCompared: result.fieldsCompared,
		warnings: result.warnings,
	};
}
