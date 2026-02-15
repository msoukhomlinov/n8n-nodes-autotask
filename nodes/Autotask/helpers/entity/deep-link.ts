import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskCredentials } from '../../types/base/auth';

/**
 * Mapping of entity types to their ExecuteCommand code and parameter name.
 * @see https://www.autotask.net/help/developerhelp/Content/APIs/ExecuteCommand/UsingExecuteCommandAPI.htm
 */
const ENTITY_LINK_MAP: Record<string, { code: string; param: string }> = {
	configurationItem: { code: 'EditInstalledProduct', param: 'InstalledProductID' },
	contact:           { code: 'OpenContact', param: 'ContactID' },
	company:           { code: 'OpenAccount', param: 'AccountID' },
	ticket:            { code: 'OpenTicketDetail', param: 'TicketID' },
	project:           { code: 'OpenProject', param: 'ProjectID' },
	contract:          { code: 'OpenContract', param: 'ContractID' },
	opportunity:       { code: 'OpenOpportunity', param: 'OpportunityID' },
};

/**
 * Derive the Autotask web UI hostname from the API zone URL.
 *
 * Standard zones: webservices{N}.autotask.net → ww{N}.autotask.net
 * Non-standard zones (prde, pres, etc.): explicit mapping.
 *
 * Returns null only if the hostname cannot be determined at all.
 */
function getWebUiHost(zoneUrl: string): string | null {
	let hostname: string;
	try {
		hostname = new URL(zoneUrl).hostname.toLowerCase();
	} catch {
		return null;
	}

	// Standard pattern: webservices{N}.autotask.net → ww{N}.autotask.net
	if (hostname.startsWith('webservices')) {
		return hostname.replace(/^webservices/, 'ww');
	}

	// Non-standard pre-release zones — map to their known web UI hosts
	const nonStandardMap: Record<string, string> = {
		'prde.autotask.net': 'prde.autotask.net',
		'pres.autotask.net': 'pres.autotask.net',
	};

	return nonStandardMap[hostname] ?? null;
}

/**
 * Build a direct web link to an Autotask entity using the ExecuteCommand API.
 *
 * Returns `null` when the web UI host cannot be determined from the zone URL
 * or the entity type has no known link mapping.
 */
export async function buildEntityDeepLink(
	context: IExecuteFunctions,
	entityType: string,
	entityId: number,
): Promise<string | null> {
	const mapping = ENTITY_LINK_MAP[entityType.toLowerCase()];
	if (!mapping) return null;

	const credentials = await context.getCredentials('autotaskApi') as IAutotaskCredentials | undefined;
	if (!credentials) return null;

	const zoneUrl = credentials.zone === 'other'
		? credentials.customZoneUrl || ''
		: credentials.zone;

	const webHost = getWebUiHost(zoneUrl);
	if (!webHost) return null;

	return `https://${webHost}/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=${mapping.code}&${mapping.param}=${entityId}`;
}
