import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions, ICredentialDataDecryptedObject } from 'n8n-workflow';
import { clearAiToolDebugLogDir, setAiToolDebugLogDir } from '../../ai-tools/debug-trace';
import { CacheService, hashCachePayload } from './service';

// Track the cache state to avoid unnecessary clearing
let lastCacheState: {
	credentialsId?: string;
	enabled?: boolean;
} = {};

interface MetadataFieldFingerprint {
	id: string;
	type?: string;
	required?: boolean;
	udf?: boolean;
	isPickList?: boolean;
	isReference?: boolean;
	referencesEntity?: string;
	picklistParentField?: string;
	allowedValueCount?: number;
}

function fingerprintFields(fields: Array<Record<string, unknown>>): MetadataFieldFingerprint[] {
	return fields
		.map((field) => ({
			id: String(field.id ?? ''),
			type: typeof field.type === 'string' ? field.type : undefined,
			required: Boolean(field.required),
			udf: Boolean(field.udf),
			isPickList: Boolean(field.isPickList),
			isReference: Boolean(field.isReference),
			referencesEntity:
				typeof field.referencesEntity === 'string' ? field.referencesEntity : undefined,
			picklistParentField:
				typeof field.picklistParentField === 'string' ? field.picklistParentField : undefined,
			allowedValueCount: Array.isArray(field.allowedValues) ? field.allowedValues.length : 0,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function computeMetadataRevision(
	readFields: Array<Record<string, unknown>>,
	writeFields: Array<Record<string, unknown>>,
): string {
	return hashCachePayload({
		read: fingerprintFields(readFields),
		write: fingerprintFields(writeFields),
	});
}

/**
 * Initialize cache service with credentials
 */
export async function initializeCache(
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
): Promise<CacheService | undefined> {
	try {
		const credentials = await context.getCredentials('autotaskApi') as ICredentialDataDecryptedObject;
		const credentialsId = (credentials.Username as string) || 'default';
		const cacheEnabled = credentials.cacheEnabled as boolean;

		// Only clear cache instances if the cache state has changed from enabled to disabled
		if (!cacheEnabled && lastCacheState.enabled === true) {
			console.debug('Cache disabled in credentials, clearing all cache instances');
			CacheService.clearAllInstances();
		}

		// Update the last cache state
		lastCacheState = {
			credentialsId,
			enabled: cacheEnabled,
		};

		if (!cacheEnabled) {
			clearAiToolDebugLogDir();
			return undefined;
		}

		const cacheService = CacheService.getInstance(
			{
				enabled: cacheEnabled,
				ttl: credentials.cacheTTL as number,
				entityInfo: {
					enabled: credentials.cacheEntityInfo as boolean,
					ttl: credentials.cacheEntityInfoTTL as number,
				},
				referenceFields: {
					enabled: credentials.cacheReferenceFields as boolean,
					ttl: credentials.cacheReferenceTTL as number,
				},
				picklists: {
					enabled: credentials.cachePicklists as boolean,
					ttl: credentials.cachePicklistsTTL as number,
				},
			},
			credentialsId,
			credentials.cacheDirectory as string,
			credentials.cacheMaxSize as number
		);
		const credentialDir = cacheService.getCredentialCacheDirectory();
		if (credentialDir) {
			setAiToolDebugLogDir(credentialDir);
		}
		return cacheService;
	} catch (error) {
		console.warn('Failed to initialize cache service:', error);
	}
	return undefined;
}
