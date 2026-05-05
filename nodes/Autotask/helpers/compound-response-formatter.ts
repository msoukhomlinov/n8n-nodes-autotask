import type { IDataObject } from 'n8n-workflow';
import { COMPOUND_REGISTRY } from '../constants/compound-registry';

/**
 * Build the parent/scope context block from a raw compound helper result.
 * Mirrors buildCompoundContext in ai-tools/operation-handlers/compound-operations.ts.
 */
export function buildCompoundContextFromResult(
	resource: string,
	result: Record<string, unknown>,
): Record<string, unknown> | undefined {
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
 * Format a raw compound helper result into the standard createIfNotExists response
 * shape for the standard node path (Autotask.node.ts → resource execute.ts).
 *
 * Produces the same structure as the AI tools path (handleCreateIfNotExists in
 * compound-operations.ts) minus AI-specific fields (resolvedLabels, pendingConfirmations,
 * summary, operation — those are not meaningful in the standard workflow node context).
 *
 * Fields included:
 *   outcome, id/existingId, record{} (created/updated only), dedupFields,
 *   updateFields (when non-empty), matchedDedupFields, fieldsUpdated,
 *   fieldsCompared, context, warnings
 */
export function formatCompoundResponse(
	resource: string,
	result: Record<string, unknown>,
	createFields: Record<string, unknown>,
	dedupFields: string[],
	updateFields: string[],
): IDataObject {
	const registryEntry = COMPOUND_REGISTRY[resource];
	const entityIdField = registryEntry?.entityIdField;
	const entityId = entityIdField
		? (result[entityIdField] as number | undefined)
		: ((result.id ?? result.itemId) as number | undefined);

	const outcome = result.outcome as string;

	const response: IDataObject = { outcome };

	if (entityId !== undefined) {
		if (outcome === 'created') {
			response.id = entityId;
		} else {
			response.existingId = entityId;
		}
	}

	// Echo all supplied entity fields as record{} for created/updated outcomes.
	// recordExcludeFields strips helper-only inputs (e.g. materialCode → billingCodeID)
	// that the helper resolves internally and never writes to the API as-is.
	if (outcome === 'created' || outcome === 'updated') {
		const excludeSet = new Set(registryEntry?.recordExcludeFields ?? []);
		const record: IDataObject = {};
		for (const [k, v] of Object.entries(createFields)) {
			if (!excludeSet.has(k)) record[k] = v as IDataObject[string];
		}
		if (entityId !== undefined) record.id = entityId;
		response.record = record;
	}

	response.dedupFields = dedupFields;
	if (updateFields.length > 0) response.updateFields = updateFields;

	if (result.matchedDedupFields !== undefined)
		response.matchedDedupFields = result.matchedDedupFields as IDataObject[string];
	if (result.fieldsCompared !== undefined)
		response.fieldsCompared = result.fieldsCompared as IDataObject[string];
	if (result.fieldsUpdated !== undefined)
		response.fieldsUpdated = result.fieldsUpdated as IDataObject[string];

	const context = buildCompoundContextFromResult(resource, result);
	if (context !== undefined) response.context = context as IDataObject[string];

	response.warnings = (result.warnings as string[]) ?? [];

	return response;
}
