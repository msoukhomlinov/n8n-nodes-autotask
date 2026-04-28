import type { IDataObject } from 'n8n-workflow';
import type { ExecutorState } from '../executor-state';
import { attachCorrelation, buildCompoundResponse } from '../response-builder';
import { wrapError, ERROR_TYPES } from '../error-formatter';
import { enrichResponseJson } from '../../helpers/enrichment';
import { convertDatesToUTC } from '../../helpers/date-time/utils';
import {
	COMPOUND_REGISTRY,
	COMPOUND_PARENT_NOT_FOUND_OUTCOMES,
} from '../../constants/compound-registry';

/** Extract the canonical created-entity numeric ID from a compound creator result. */

function buildCompoundEntityId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.entityIdField;
	return field ? result[field] : (result.id ?? result.itemId);
}

/** Extract the canonical existing-entity numeric ID from a compound creator result (skip/update). */

function buildCompoundExistingId(resource: string, result: any): number | undefined {
	const field = COMPOUND_REGISTRY[resource]?.existingIdField;
	return field ? result[field] : result.existingId;
}

/** Build the context block (parent/scope fields) for a compound creator result. */

function buildCompoundContext(resource: string, result: any): Record<string, unknown> | undefined {
	switch (resource) {
		case 'contractCharge':
			return result.contractId !== undefined ? { contractId: result.contractId } : undefined;
		case 'ticketCharge':
			return { ticketId: result.ticketId, ticketID: result.ticketID };
		case 'projectCharge':
			return result.projectId !== undefined ? { projectId: result.projectId } : undefined;
		case 'configurationItems':
			return { companyID: result.companyID };
		case 'timeEntry': {
			const ctx: Record<string, unknown> = { resourceID: result.resourceID };
			if (result.ticketID !== undefined) ctx.ticketID = result.ticketID;
			if (result.taskID !== undefined) ctx.taskID = result.taskID;
			return ctx;
		}
		case 'contractService':
			return result.contractId !== undefined ? { contractId: result.contractId } : undefined;
		case 'contract':
			return { companyID: result.companyID };
		case 'opportunity':
			return undefined;
		case 'expenseItem':
			return { expenseReportID: result.expenseReportID };
		case 'ticketAdditionalConfigurationItem':
			return result.ticketID !== undefined ? { ticketID: result.ticketID } : undefined;
		case 'ticketAdditionalContact':
			return result.ticketID !== undefined ? { ticketID: result.ticketID } : undefined;
		case 'changeRequestLink': {
			const ctx: Record<string, unknown> = {};
			if (result.changeRequestTicketID !== undefined)
				ctx.changeRequestTicketID = result.changeRequestTicketID;
			if (result.problemOrIncidentTicketID !== undefined)
				ctx.problemOrIncidentTicketID = result.problemOrIncidentTicketID;
			return Object.keys(ctx).length > 0 ? ctx : undefined;
		}
		case 'holidaySet':
			return undefined;
		case 'holiday':
			return result.holidaySetId !== undefined ? { holidaySetId: result.holidaySetId } : undefined;
		default:
			return undefined;
	}
}

/**
 * Compound operation handler — short-circuits in tool-executor.ts before the
 * standard executor path. Dispatches to entity-specific helper from
 * COMPOUND_REGISTRY using validated + label-resolved fieldValues.
 *
 * Returns null when the resource has no compound handler registered (caller
 * should treat this as "not handled" and continue down the normal path is
 * not applicable here — registry-miss is a hard error response).
 */
export async function handleCreateIfNotExists(state: ExecutorState): Promise<string | null> {
	const {
		context,
		resource,
		params,
		correlationId,
		fieldValues,
		labelWarnings,
		labelResolutions,
		labelPendingConfirmations,
		resolvedImpersonationId,
	} = state;

	// createFields comes from fieldValues (already validated + label-resolved above)
	// Convert date fields from user timezone to UTC before passing to compound helpers,
	// which bypass CreateOperation.execute() and therefore convertDatesToUTC.
	const createFields: Record<string, unknown> = (await convertDatesToUTC(
		{ ...fieldValues } as IDataObject,
		resource,
		context,
		'createIfNotExists',
	)) as Record<string, unknown>;
	const registryEntry = COMPOUND_REGISTRY[resource];
	if (!registryEntry) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					'createIfNotExists',
					ERROR_TYPES.INVALID_OPERATION,
					`createIfNotExists is not implemented for resource '${resource}'.`,
					`Use autotask_${resource} with operation 'create' instead.`,
				),
			),
			correlationId,
		);
	}
	const dedupFields = (params.dedupFields as string[]) ?? registryEntry.defaultDedupFields;
	const errorOnDuplicate = params.errorOnDuplicate === true;
	const updateFields = (params.updateFields as string[] | undefined) ?? [];

	const compoundOptions = {
		createFields,
		dedupFields,
		errorOnDuplicate,
		updateFields,
		impersonationResourceId: resolvedImpersonationId,
		proceedWithoutImpersonationIfDenied: params.proceedWithoutImpersonationIfDenied !== false,
	};

	const handler = await registryEntry.getHandler();

	const compoundResult: any = await handler(context, 0, compoundOptions);

	if (!compoundResult) {
		// Helper returned falsy — let caller fall through to standard executor.
		return null;
	}

	// Reclassify not-found outcomes as errors
	if (COMPOUND_PARENT_NOT_FOUND_OUTCOMES.has(compoundResult.outcome)) {
		const parentRef =
			compoundResult.parentLookupValue ??
			compoundResult.companyID ??
			compoundResult.ticketID ??
			'unknown';
		return attachCorrelation(
			JSON.stringify(
				wrapError(
					resource,
					'createIfNotExists',
					ERROR_TYPES.ENTITY_NOT_FOUND,
					`Parent entity not found: ${parentRef}`,
					`Verify the parent entity identifier and retry.`,
					{ outcome: compoundResult.outcome },
				),
			),
			correlationId,
		);
	}

	// Merge compound warnings with label resolution warnings
	const rawCompoundWarnings: string[] = Array.isArray(compoundResult.warnings)
		? compoundResult.warnings
		: [];
	const allWarnings = [...rawCompoundWarnings, ...labelWarnings];

	const entityId = buildCompoundEntityId(resource, compoundResult);
	const existingEntityId = buildCompoundExistingId(resource, compoundResult);
	const compoundContext = buildCompoundContext(resource, compoundResult);

	const compoundData: Record<string, unknown> = {
		outcome: compoundResult.outcome,
	};
	if (entityId !== undefined) compoundData.id = entityId;
	if (existingEntityId !== undefined) compoundData.existingId = existingEntityId;
	if (compoundResult.matchedDedupFields !== undefined)
		compoundData.matchedDedupFields = compoundResult.matchedDedupFields;
	if (compoundResult.fieldsUpdated !== undefined)
		compoundData.fieldsUpdated = compoundResult.fieldsUpdated;
	if (compoundResult.fieldsCompared !== undefined)
		compoundData.fieldsCompared = compoundResult.fieldsCompared;
	if (compoundContext !== undefined) compoundData.context = compoundContext;

	const compoundJson = JSON.stringify(
		buildCompoundResponse(
			resource,
			'createIfNotExists',
			compoundData as Parameters<typeof buildCompoundResponse>[2],
			{
				resolutions: labelResolutions,
				resolutionWarnings: allWarnings,
				pendingConfirmations: labelPendingConfirmations,
			},
		),
	);
	const enrichedCompoundJson = await enrichResponseJson(compoundJson, context);
	return attachCorrelation(enrichedCompoundJson, correlationId);
}
