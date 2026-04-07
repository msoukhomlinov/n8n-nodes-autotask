import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { compareDedupField, extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IChargeCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ChargeCreateOutcome = 'created' | 'skipped' | 'updated' | 'parent_not_found';

export interface IChargeCreateResult {
	outcome: ChargeCreateOutcome;
	parentId?: number;
	chargeId?: number;
	existingChargeId?: number;
	parentLookupValue: string;
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

/**
 * Configuration for a specific charge type (contract, ticket, project).
 * Parameterises the generic charge creation flow.
 */
export interface ChargeCreatorConfig {
	/** Human-readable parent entity name for error messages (e.g. "Contract", "Ticket", "Project") */
	parentEntityLabel: string;
	/** API query endpoint for finding the parent (e.g. "Contracts/query", "Tickets/query") */
	parentQueryEndpoint: string;
	/** Field name used to look up the parent (e.g. "externalServiceIdentifier", "ticketNumber", "projectNumber") */
	parentLookupField: string;
	/** API entity name for charges query (e.g. "ContractCharges/query", "TicketCharges/query") */
	chargeQueryEndpoint: string;
	/** Parent ID field name on the charge entity (e.g. "contractID", "ticketID", "projectID") */
	chargeParentIdField: string;
	/** API create endpoint template — {parentId} is replaced at runtime */
	chargeCreateEndpointTemplate: string;
	/** Maps API field name to its data type for dedup comparison */
	fieldTypeMap?: Record<string, string>;
	/** Entity name as registered in constants/entities.ts (e.g. 'ContractCharge') — used for update-on-drift */
	entityName: string;
}

// ─── Shared Step Implementations ─────────────────────────────────────────────

/**
 * Step 1: Find the parent entity by a lookup field value.
 */
export async function findParentEntity(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	lookupValue: string,
): Promise<{ parents: IDataObject[]; warnings: string[] }> {
	const warnings: string[] = [];

	const response = await autotaskApiRequest.call(
		ctx, 'POST', config.parentQueryEndpoint,
		{ filter: [{ field: config.parentLookupField, op: 'eq', value: lookupValue }] },
	);

	const parents = extractItems(response as IDataObject);

	if (parents.length > 1) {
		warnings.push(
			`Multiple ${config.parentEntityLabel}s (${parents.length}) found for ${config.parentLookupField} '${lookupValue}'. Using first (ID: ${parents[0]?.id}).`,
		);
	}

	return { parents, warnings };
}

/**
 * Step 2: Check for duplicate charges using configurable dedup fields.
 */
export async function findDuplicateCharge(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentId: number,
	options: IChargeCreateIfNotExistsOptions,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	const { dedupFields, createFields } = options;

	if (!dedupFields || dedupFields.length === 0) {
		return { duplicate: null, matchedFields: [] };
	}

	// API filter: always filter by parent ID, plus name if in dedupFields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiFilter: any[] = [
		{ field: config.chargeParentIdField, op: 'eq', value: parentId },
	];
	if (dedupFields.includes('name')) {
		apiFilter.push({ field: 'name', op: 'eq', value: createFields.name });
	}

	const response = await autotaskApiRequest.call(
		ctx, 'POST', config.chargeQueryEndpoint, { filter: apiFilter },
	);

	const charges = extractItems(response as IDataObject);
	const fieldTypeMap = config.fieldTypeMap ?? {};

	// Client-side precision match on ALL selected dedupFields
	for (const charge of charges) {
		const matched: string[] = [];
		let allMatch = true;

		for (const field of dedupFields) {
			const fieldType = fieldTypeMap[field] ?? 'string';

			// Get the input value from createFields
			const inputValue = createFields[field];
			const apiValue = charge[field];

			if (compareDedupField(fieldType, apiValue, inputValue)) {
				matched.push(field);
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch && matched.length === dedupFields.length) {
			return { duplicate: charge, matchedFields: matched };
		}
	}

	return { duplicate: null, matchedFields: [] };
}

/**
 * Step 3: Resolve billing code by materialCode or direct billingCodeID.
 */
export async function resolveBillingCodeId(
	ctx: IExecuteFunctions,
	createFields: Record<string, unknown>,
): Promise<{ billingCodeID: number | undefined; warnings: string[] }> {
	const warnings: string[] = [];
	const billingCodeID = createFields.billingCodeID as number | undefined;
	const materialCode = createFields.materialCode as string | undefined;

	if (billingCodeID !== undefined && materialCode) {
		warnings.push(
			'Both materialCode and billingCodeID provided. Using billingCodeID directly; materialCode ignored.',
		);
		return { billingCodeID, warnings };
	}

	if (billingCodeID !== undefined) {
		return { billingCodeID, warnings };
	}

	if (!materialCode) {
		return { billingCodeID: undefined, warnings };
	}

	// Lookup by materialCode
	const response = await autotaskApiRequest.call(
		ctx, 'POST', 'BillingCodes/query',
		{ filter: [{ field: 'materialCode', op: 'eq', value: materialCode }] },
	);

	const codes = extractItems(response as IDataObject);

	if (codes.length === 0) {
		throw new Error(
			`BillingCode with materialCode '${materialCode}' not found. Verify the material code or provide billingCodeID directly.`,
		);
	}

	// Prefer active billing codes
	const activeCodes = codes.filter(c => c.isActive !== false);
	const chosen = activeCodes.length > 0 ? activeCodes[0] : codes[0];

	if (codes.length > 1) {
		warnings.push(
			`Multiple BillingCodes (${codes.length}) found for materialCode '${materialCode}'. Using first active (ID: ${chosen.id}).`,
		);
	}

	return { billingCodeID: chosen.id as number, warnings };
}

/**
 * Step 4: Create the charge on the parent entity.
 */
export async function createCharge(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentId: number,
	billingCodeID: number | undefined,
	options: IChargeCreateIfNotExistsOptions,
): Promise<number> {
	const body: IDataObject = {
		...options.createFields as IDataObject,
		[config.chargeParentIdField]: parentId,
	};

	// Override billingCodeID if resolved
	if (billingCodeID !== undefined) {
		body.billingCodeID = billingCodeID;
	}

	// Strip non-API fields
	delete body.materialCode;
	delete body.dedupFields;
	delete body.errorOnDuplicate;

	// Strip parent lookup field if different from chargeParentIdField
	if (config.parentLookupField !== config.chargeParentIdField) {
		delete body[config.parentLookupField];
	}

	const endpoint = config.chargeCreateEndpointTemplate.replace('{parentId}', String(parentId));

	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		endpoint,
		body,
		{},
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied ?? true,
	);

	const chargeId = extractId(response as IDataObject);
	if (!chargeId) {
		throw new Error('Charge creation succeeded but returned no ID.');
	}
	return chargeId;
}

/**
 * Main orchestrator for all charge-type createIfNotExists operations.
 */
export async function createChargeIfNotExists(
	ctx: IExecuteFunctions,
	config: ChargeCreatorConfig,
	parentLookupValue: string,
	options: IChargeCreateIfNotExistsOptions,
): Promise<IChargeCreateResult> {
	const warnings: string[] = [];

	// Step 1: Find parent
	const { parents, warnings: parentWarnings } = await findParentEntity(
		ctx, config, parentLookupValue,
	);
	warnings.push(...parentWarnings);

	if (parents.length === 0) {
		return {
			outcome: 'parent_not_found',
			parentLookupValue,
			chargeName: (options.createFields.name as string) ?? '',
			datePurchased: (options.createFields.datePurchased as string) ?? '',
			warnings,
		};
	}

	const parentId = parents[0].id as number;

	// Step 2: Check for duplicate
	const { duplicate, matchedFields } = await findDuplicateCharge(ctx, config, parentId, options);

	if (duplicate) {
		if (options.errorOnDuplicate) {
			throw new Error(
				`Duplicate charge found (ID: ${duplicate.id}) on ${config.parentEntityLabel} ${parentId}. ` +
				`Matched dedup fields: ${matchedFields.join(', ')}. ` +
				`Set errorOnDuplicate=false to skip instead of error.`,
			);
		}

		const { updateFields } = options;
		if (updateFields && updateFields.length > 0) {
			const fieldTypeMap = config.fieldTypeMap ?? {};
			const { patch, compared, skipped, warnings: diffWarnings } = computeFieldDiffs(
				duplicate as Record<string, unknown>,
				options.createFields,
				updateFields,
				fieldTypeMap,
			);
			if (skipped.length > 0) {
				diffWarnings.push(`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`);
			}
			if (Object.keys(patch).length > 0) {
				const { updatedEntity, warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: config.entityName,
					duplicateId: duplicate.id as number,
					parentId,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					existingChargeId: duplicate.id as number,
					parentId,
					parentLookupValue,
					chargeName: (options.createFields.name as string) ?? (updatedEntity.name as string) ?? '',
					datePurchased: (options.createFields.datePurchased as string) ?? '',
					unitQuantity: options.createFields.unitQuantity as number | undefined,
					unitPrice: options.createFields.unitPrice as number | undefined,
					matchedDedupFields: matchedFields,
					fieldsUpdated: Object.keys(patch),
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings, ...updateWarnings],
				};
			} else {
				return {
					outcome: 'skipped',
					reason: 'duplicate_no_changes',
					existingChargeId: duplicate.id as number,
					parentId,
					parentLookupValue,
					chargeName: (options.createFields.name as string) ?? '',
					datePurchased: (options.createFields.datePurchased as string) ?? '',
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			reason: 'duplicate_charge',
			existingChargeId: duplicate.id as number,
			parentId,
			parentLookupValue,
			chargeName: (options.createFields.name as string) ?? '',
			datePurchased: (options.createFields.datePurchased as string) ?? '',
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Resolve billing code
	const { billingCodeID, warnings: billingWarnings } = await resolveBillingCodeId(ctx, options.createFields);
	warnings.push(...billingWarnings);

	// Step 4: Create charge
	const chargeId = await createCharge(ctx, config, parentId, billingCodeID, options);

	return {
		outcome: 'created',
		chargeId,
		parentId,
		parentLookupValue,
		chargeName: (options.createFields.name as string) ?? '',
		datePurchased: (options.createFields.datePurchased as string) ?? '',
		unitQuantity: options.createFields.unitQuantity as number | undefined,
		unitPrice: options.createFields.unitPrice as number | undefined,
		warnings,
	};
}

