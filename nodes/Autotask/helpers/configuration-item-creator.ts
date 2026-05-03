import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { autotaskApiRequest } from './http';
import { extractId, extractItems } from './dedup-utils';
import { computeFieldDiffs, applyDuplicateUpdate } from './update-fields-on-duplicate';
import { findDuplicate } from './entity-dedup';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IConfigurationItemCreateIfNotExistsOptions {
	createFields: Record<string, unknown>;
	dedupFields: string[];
	errorOnDuplicate: boolean;
	impersonationResourceId?: number;
	proceedWithoutImpersonationIfDenied?: boolean;
	updateFields?: string[];
}

export type ConfigurationItemCreateOutcome = 'created' | 'skipped' | 'updated' | 'company_not_found';

export interface IConfigurationItemCreateResult {
	outcome: ConfigurationItemCreateOutcome;
	companyID: string | number;
	configurationItemId?: number;
	existingConfigurationItemId?: number;
	reason?: string;
	matchedDedupFields?: string[];
	fieldsUpdated?: string[];
	fieldsCompared?: string[];
	warnings: string[];
}

// ─── CI dedup field type map ──────────────────────────────────────────────────

/**
 * CI dedup fields are typically string-typed.
 * Any field not listed here defaults to 'string' in compareDedupField.
 */
const CI_FIELD_TYPE_MAP: Record<string, string> = {
	serialNumber: 'string',
	referenceNumber: 'string',
	rmmDeviceUID: 'string',
	referenceTitle: 'string',
};

// ─── Step 1: Verify company exists ───────────────────────────────────────────

async function verifyCompanyExists(
	ctx: IExecuteFunctions,
	companyID: string | number,
): Promise<boolean> {
	const response = await autotaskApiRequest.call(
		ctx,
		'POST',
		'Companies/query',
		{ filter: [{ field: 'id', op: 'eq', value: companyID }] },
	);

	const companies = extractItems(response as IDataObject);
	return companies.length > 0;
}

// ─── Step 2: Find duplicate CI ───────────────────────────────────────────────

function findDuplicateConfigurationItem(
	ctx: IExecuteFunctions,
	companyID: string | number,
	dedupFields: string[],
	createFields: Record<string, unknown>,
): Promise<{ duplicate: IDataObject | null; matchedFields: string[] }> {
	return findDuplicate(ctx, {
		entityType: 'ConfigurationItem',
		queryEndpoint: 'ConfigurationItems/query',
		scopeFilters: [{ field: 'companyID', op: 'eq', value: companyID }],
		dedupFields,
		createFields,
		fieldTypeMap: CI_FIELD_TYPE_MAP,
	});
}

// ─── Step 3: Create the configuration item ───────────────────────────────────

async function createConfigurationItem(
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
		'ConfigurationItems',
		body,
		{},
		impersonationResourceId,
		proceedWithoutImpersonationIfDenied ?? true,
	);

	const itemId = extractId(response as IDataObject);
	if (!itemId) {
		throw new Error('ConfigurationItem creation succeeded but returned no ID.');
	}
	return itemId;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function createConfigurationItemIfNotExists(
	ctx: IExecuteFunctions,
	_itemIndex: number,
	options: IConfigurationItemCreateIfNotExistsOptions,
): Promise<IConfigurationItemCreateResult> {
	const warnings: string[] = [];
	const { createFields, dedupFields, errorOnDuplicate } = options;

	const companyID = createFields.companyID as string | number | undefined;
	if (companyID === undefined || companyID === null) {
		throw new Error('createFields.companyID is required for configurationItems.createIfNotExists');
	}

	// Step 1: Verify company exists
	const companyExists = await verifyCompanyExists(ctx, companyID);
	if (!companyExists) {
		return {
			outcome: 'company_not_found',
			companyID,
			warnings,
		};
	}

	// Step 2: Check for duplicate CI
	const { duplicate, matchedFields } = await findDuplicateConfigurationItem(
		ctx,
		companyID,
		dedupFields,
		createFields,
	);

	if (duplicate) {
		if (errorOnDuplicate) {
			throw new Error(
				`Duplicate ConfigurationItem found (ID: ${duplicate.id}) for companyID ${companyID}. ` +
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
				CI_FIELD_TYPE_MAP,
			);
			if (skipped.length > 0) {
				diffWarnings.push(`updateFields requested for ${skipped.length} field(s) not present in createFields: ${skipped.join(', ')}`);
			}
			if (Object.keys(patch).length > 0) {
				const { warnings: updateWarnings } = await applyDuplicateUpdate(ctx, {
					resource: 'ConfigurationItem',
					duplicateId: duplicate.id as number,
					patch,
					impersonationResourceId: options.impersonationResourceId,
					proceedWithoutImpersonationIfDenied: options.proceedWithoutImpersonationIfDenied,
				});
				return {
					outcome: 'updated',
					companyID,
					existingConfigurationItemId: duplicate.id as number,
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
					existingConfigurationItemId: duplicate.id as number,
					matchedDedupFields: matchedFields,
					fieldsCompared: compared,
					warnings: [...warnings, ...diffWarnings],
				};
			}
		}

		return {
			outcome: 'skipped',
			companyID,
			reason: 'duplicate_configuration_item',
			existingConfigurationItemId: duplicate.id as number,
			matchedDedupFields: matchedFields,
			warnings,
		};
	}

	// Step 3: Create the configuration item
	const configurationItemId = await createConfigurationItem(
		ctx,
		createFields,
		options.impersonationResourceId,
		options.proceedWithoutImpersonationIfDenied,
	);

	return {
		outcome: 'created',
		companyID,
		configurationItemId,
		warnings,
	};
}
