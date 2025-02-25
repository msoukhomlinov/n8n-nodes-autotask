import type { IExecuteFunctions, ILoadOptionsFunctions, IHookFunctions, ICredentialDataDecryptedObject } from 'n8n-workflow';
import { CacheService } from './service';

/**
 * Initialize cache service with credentials
 */
export async function initializeCache(
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
): Promise<CacheService | undefined> {
	try {
		const credentials = await context.getCredentials('autotaskApi') as ICredentialDataDecryptedObject;
		if (credentials.cacheEnabled) {
			return CacheService.getInstance(
				{
					enabled: credentials.cacheEnabled as boolean,
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
				(credentials.Username as string) || 'default',
			);
		}
	} catch (error) {
		console.warn('Failed to initialize cache service:', error);
	}
	return undefined;
}
