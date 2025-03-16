import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions, ICredentialDataDecryptedObject } from 'n8n-workflow';
import { CacheService } from './service';

// Track the cache state to avoid unnecessary clearing
let lastCacheState: {
	credentialsId?: string;
	enabled?: boolean;
} = {};

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

		if (cacheEnabled) {
			return CacheService.getInstance(
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
		}
	} catch (error) {
		console.warn('Failed to initialize cache service:', error);
	}
	return undefined;
}
