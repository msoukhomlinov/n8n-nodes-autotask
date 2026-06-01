import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import type { ExecutorState } from '../executor-state';
import type { IAutotaskEntity } from '../../types';
import { autotaskApiRequest } from '../../helpers/http';
import { attachCorrelation, buildListResponse } from '../response-builder';
import { wrapError, ERROR_TYPES } from '../error-formatter';
import { enrichResponseJson } from '../../helpers/enrichment';
import { MAX_QUERY_LIMIT } from '../tool-executor-helpers';

export async function handleGetAvailableRoles(state: ExecutorState): Promise<string> {
	const { context, resource, params, correlationId } = state;

	const rawResourceId = (params as Record<string, unknown>).resourceID;
	if (rawResourceId === undefined || rawResourceId === null || String(rawResourceId).trim() === '') {
		return attachCorrelation(
			JSON.stringify(
				wrapError(resource, 'getAvailableRoles', ERROR_TYPES.MISSING_REQUIRED_FIELDS,
					'resourceID is required.',
					`Call autotask_${resource} with operation 'getAvailableRoles' and provide resourceID.`,
					{ missingFields: ['resourceID'] }),
			),
			correlationId,
		);
	}

	// Resolve resourceID string label → numeric ID if needed
	let resolvedResourceId: number;
	const rawResStr = String(rawResourceId).trim();
	const isNumericRes =
		typeof rawResourceId === 'number' ||
		(/^\d+$/.test(rawResStr) && String(parseInt(rawResStr, 10)) === rawResStr && parseInt(rawResStr, 10) > 0);

	if (isNumericRes) {
		resolvedResourceId = typeof rawResourceId === 'number' ? rawResourceId : parseInt(rawResStr, 10);
	} else {
		try {
			const { EntityValueHelper } = await import('../../helpers/entity-values/value-helper');
			const helper = new EntityValueHelper(
				context as unknown as ILoadOptionsFunctions,
				'Resource',
			);
			const candidates = await helper.getValues(true);
			const label = rawResStr.toLowerCase();
			let matchedId: number | undefined;
			for (const entity of candidates) {
				const obj = entity as unknown as IDataObject;
				const display = helper.getEntityDisplayName(obj);
				if (display && display.toLowerCase() === label) {
					matchedId = obj.id as number;
					break;
				}
				const emails = [obj.email, obj.email2, obj.email3] as (string | undefined)[];
				if (emails.some((e) => e && e.toLowerCase() === label)) {
					matchedId = obj.id as number;
					break;
				}
			}
			if (matchedId === undefined) {
				return attachCorrelation(
					JSON.stringify(
						wrapError(resource, 'getAvailableRoles', ERROR_TYPES.ENTITY_NOT_FOUND,
							`Resource '${rawResStr}' not found.`,
							`Call autotask_resource with operation 'getMany' to find the correct resource name or ID.`,
							{}),
					),
					correlationId,
				);
			}
			resolvedResourceId = matchedId;
		} catch (e) {
			return attachCorrelation(
				JSON.stringify(
					wrapError(resource, 'getAvailableRoles', ERROR_TYPES.API_ERROR,
						`Resource lookup failed: ${(e as Error).message}`,
						`Provide a numeric resourceID instead.`,
						{}),
				),
				correlationId,
			);
		}
	}

	const toNumericId = (v: unknown): number | undefined => {
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : undefined;
	};
	let queueId = toNumericId((params as Record<string, unknown>).queueID);
	let contractId = toNumericId((params as Record<string, unknown>).contractID);
	let suggestedDefaultRoleId: number | undefined;
	const garWarnings: string[] = [];

	// Fetch ticket if ticketID provided and we need queueID/contractID
	const ticketId = toNumericId((params as Record<string, unknown>).ticketID);
	if (ticketId && (!queueId || !contractId)) {
		try {
			const ticketResponse = await autotaskApiRequest.call(
				context, 'GET', `Tickets/${ticketId}`,
			) as { item?: IAutotaskEntity };
			const ticket = ticketResponse?.item;
			if (ticket) {
				if (!queueId && ticket.queueID) queueId = Number(ticket.queueID);
				if (!contractId && ticket.contractID) contractId = Number(ticket.contractID);
				if (ticket.assignedResourceRoleID) suggestedDefaultRoleId = Number(ticket.assignedResourceRoleID);
			} else {
				garWarnings.push(`Ticket ${ticketId} not found — could not derive queueID/contractID.`);
			}
		} catch (e) {
			garWarnings.push(`Failed to fetch ticket ${ticketId}: ${(e as Error).message}`);
		}
	}

	// Fetch resource roles
	let resourceRoleRows: Array<{ roleID: number; queueID?: number; isActive?: boolean }> = [];
	try {
		const rrResponse = await autotaskApiRequest.call(
			context, 'GET', `Resources/${resolvedResourceId}/Roles`,
		) as { items?: Array<{ roleID: number; queueID?: number; isActive?: boolean }> };
		resourceRoleRows = rrResponse?.items ?? [];
	} catch (e) {
		return attachCorrelation(
			JSON.stringify(
				wrapError(resource, 'getAvailableRoles', ERROR_TYPES.API_ERROR,
					`Failed to fetch roles for resource ${resolvedResourceId}: ${(e as Error).message}`,
					`Verify resourceID is correct using autotask_resource with operation 'get'.`,
					{}),
			),
			correlationId,
		);
	}

	// Filter: active only, and by queueID if known
	let filtered = resourceRoleRows.filter(row => row.isActive !== false);
	if (queueId) {
		const queueFiltered = filtered.filter(row => row.queueID === queueId);
		if (queueFiltered.length > 0) {
			filtered = queueFiltered;
		} else {
			garWarnings.push(`No roles matched queue ${queueId} — returning all active roles for this resource.`);
		}
	}

	// Distinct roleIDs
	let availableRoleIds = [...new Set(filtered.map(row => Number(row.roleID)))];

	// Apply contract exclusions
	if (contractId && availableRoleIds.length > 0) {
		try {
			const exclusionResponse = await autotaskApiRequest.call(
				context, 'POST', 'ContractExclusionRoles/query',
				{
					filter: [{ field: 'contractID', op: 'eq', value: contractId }],
				} as IDataObject,
			) as { items?: Array<{ roleID: number }> };
			const excluded = new Set<number>(
				(exclusionResponse?.items ?? []).map(row => Number(row.roleID))
			);
			const before = availableRoleIds.length;
			availableRoleIds = availableRoleIds.filter(id => !excluded.has(id));
			if (availableRoleIds.length < before) {
				garWarnings.push(`${before - availableRoleIds.length} role(s) excluded by contract ${contractId} exclusion rules.`);
			}
		} catch (e) {
			garWarnings.push(`Could not fetch contract exclusions for contract ${contractId}: ${(e as Error).message}`);
		}
	}

	if (availableRoleIds.length === 0) {
		const garEmptyJson = JSON.stringify(
			buildListResponse(resource, 'getAvailableRoles', [], { hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT }, {
				...(garWarnings.length > 0 ? { resolutionWarnings: garWarnings } : {}),
			}),
		);
		return attachCorrelation(garEmptyJson, correlationId);
	}

	// Batch-fetch Role records
	const { EntityValueHelper: RoleHelper } = await import('../../helpers/entity-values/value-helper');
	const roleHelper = new RoleHelper(
		context as unknown as ILoadOptionsFunctions,
		'Role',
	);
	const roleRecords = (await roleHelper.getValuesByIds(availableRoleIds, ['id', 'name', 'description', 'isActive'])) as Record<string, unknown>[];

	// Build output records, flag suggestedDefault
	const garRecords = roleRecords
		.filter(r => r['isActive'] !== false)
		.map(r => ({
			...r,
			...(suggestedDefaultRoleId && Number(r['id']) === suggestedDefaultRoleId
				? { suggestedDefault: true }
				: {}),
		}));

	const garJson = JSON.stringify(
		buildListResponse(resource, 'getAvailableRoles', garRecords,
			{ hasMore: false, serverCap: MAX_QUERY_LIMIT, clientCap: MAX_QUERY_LIMIT },
			{
				...(garWarnings.length > 0 ? { resolutionWarnings: garWarnings } : {}),
			},
		),
	);
	const enrichedGarJson = await enrichResponseJson(garJson, context);
	return attachCorrelation(enrichedGarJson, correlationId);
}
