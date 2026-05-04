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
	contractID: string | number;
	chargeName: string;
	datePurchased: string;
	unitQuantity?: number;
	unitPrice?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: Record<string, { from: unknown; to: unknown }>;
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const CONTRACT_CHARGE_CONFIG_BY_ID: ChargeCreatorConfig = {
	parentEntityLabel: 'Contract',
	parentQueryEndpoint: 'Contracts/query',
	parentLookupField: 'id',
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
	const contractID = options.createFields.contractID as string | number | undefined;
	if (contractID === undefined || contractID === null || contractID === '') {
		throw new Error('contractID is required in createFields to find the contract.');
	}

	const result = await createChargeIfNotExists(
		ctx,
		CONTRACT_CHARGE_CONFIG_BY_ID,
		String(contractID),
		options,
	);

	return mapToContractChargeResult(result, contractID);
}

// ─── Result mapper ──────────────────────────────────────────────────────────

function mapToContractChargeResult(
	result: IChargeCreateResult,
	contractID: string | number,
): IContractChargeCreateIfNotExistsResult {
	const outcome = result.outcome === 'parent_not_found'
		? 'contract_not_found' as const
		: result.outcome;

	return {
		outcome,
		contractId: result.parentId,
		chargeId: result.chargeId,

		contractID,
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
