import type { IExecuteFunctions } from 'n8n-workflow';
import {
	createChargeIfNotExists,
	type IChargeCreateIfNotExistsOptions,
	type ChargeCreatorConfig,
	type IChargeCreateResult,
} from './charge-creator-base';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type IProjectChargeCreateIfNotExistsOptions = IChargeCreateIfNotExistsOptions;

export type ProjectChargeCreateIfNotExistsOutcome = 'created' | 'skipped' | 'updated' | 'project_not_found';

export interface IProjectChargeCreateIfNotExistsResult {
	outcome: ProjectChargeCreateIfNotExistsOutcome;
	projectId?: number;
	chargeId?: number;
	existingChargeId?: number;
	projectID: string | number;
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

const PROJECT_CHARGE_CONFIG_BY_ID: ChargeCreatorConfig = {
	parentEntityLabel: 'Project',
	parentQueryEndpoint: 'Projects/query',
	parentLookupField: 'id',
	chargeQueryEndpoint: 'ProjectCharges/query',
	chargeParentIdField: 'projectID',
	chargeCreateEndpointTemplate: 'Projects/{parentId}/Charges',
	entityName: 'ProjectCharge',
	fieldTypeMap: {
		name: 'string',
		datePurchased: 'datetime',
		unitQuantity: 'double',
		unitCost: 'double',
		unitPrice: 'double',
	},
};

const PROJECT_CHARGE_CONFIG_BY_NUMBER: ChargeCreatorConfig = {
	...PROJECT_CHARGE_CONFIG_BY_ID,
	parentLookupField: 'projectNumber',
};

// ─── Main orchestrator ───────────────────────────────────────────────────────

export async function createProjectChargeIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IProjectChargeCreateIfNotExistsOptions,
): Promise<IProjectChargeCreateIfNotExistsResult> {
	const projectID = options.createFields.projectID as string | number | undefined;
	if (projectID === undefined || projectID === null || projectID === '') {
		throw new Error('projectID is required in createFields to find the project.');
	}

	// Determine lookup strategy:
	// - Numeric value → look up by id field
	// - String containing non-digit characters → look up by projectNumber
	// - String of only digits → treat as numeric ID
	const isNumericId = typeof projectID === 'number' || (typeof projectID === 'string' && /^\d+$/.test(projectID) && parseInt(projectID, 10) > 0);

	const config = isNumericId
		? PROJECT_CHARGE_CONFIG_BY_ID
		: PROJECT_CHARGE_CONFIG_BY_NUMBER;

	const lookupValue = String(projectID);

	const result = await createChargeIfNotExists(
		ctx,
		config,
		lookupValue,
		options,
	);

	return mapToProjectChargeResult(result, projectID);
}

// ─── Result mapper ──────────────────────────────────────────────────────────

function mapToProjectChargeResult(
	result: IChargeCreateResult,
	projectID: string | number,
): IProjectChargeCreateIfNotExistsResult {
	const outcome = result.outcome === 'parent_not_found'
		? 'project_not_found' as const
		: result.outcome;

	return {
		outcome,
		projectId: result.parentId,
		chargeId: result.chargeId,
		existingChargeId: result.existingChargeId,
		projectID,
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
