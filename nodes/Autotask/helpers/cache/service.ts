import Keyv from 'keyv';

export interface ICacheConfig {
	enabled: boolean;
	ttl: number;
	entityInfo: {
		enabled: boolean;
		ttl: number;
	};
	referenceFields: {
		enabled: boolean;
		ttl: number;
	};
	picklists: {
		enabled: boolean;
		ttl: number;
	};
}

/**
 * Cache service for storing and retrieving field values
 * Uses in-memory storage with TTL for automatic cleanup
 */
export class CacheService {
	private static instances: Map<string, CacheService> = new Map();
	private cache: Keyv<unknown>;
	private config: ICacheConfig;
	private namespace: string;
	private metrics: {
		hits: number;
		misses: number;
	} = { hits: 0, misses: 0 };

	private constructor(config: ICacheConfig, credentialsId: string) {
		this.config = config;
		this.namespace = `autotask:${credentialsId}`;
		this.cache = new Keyv({
			namespace: this.namespace,
		});

		// Log cache errors
		this.cache.on('error', (err) => console.error('Cache Error:', err));
		console.debug(`Created new cache instance for ${credentialsId} with config:`, {
			enabled: config.enabled,
			entityInfo: config.entityInfo,
			referenceFields: config.referenceFields,
			picklists: config.picklists,
		});
	}

	/**
	 * Get the singleton instance of the cache service
	 */
	public static getInstance(config: ICacheConfig, credentialsId: string): CacheService {
		const instanceKey = `${credentialsId}:${config.enabled}`;
		const existingInstance = CacheService.instances.get(instanceKey);

		// If instance exists but config has changed, clear it
		if (existingInstance && !CacheService.configsMatch(existingInstance.config, config)) {
			console.debug(`Cache config changed for ${credentialsId}, clearing instance`);
			existingInstance.clear().catch(error => {
				console.warn('Failed to clear cache instance:', error);
			});
			CacheService.instances.delete(instanceKey);
		}

		if (!CacheService.instances.has(instanceKey)) {
			console.debug(`Creating new cache instance for ${credentialsId}`);
			CacheService.instances.set(instanceKey, new CacheService(config, credentialsId));
		} else {
			console.debug(`Reusing existing cache instance for ${credentialsId}`);
		}

		const instance = CacheService.instances.get(instanceKey);
		if (!instance) {
			throw new Error(`Failed to get cache instance for ${credentialsId}`);
		}
		return instance;
	}

	/**
	 * Compare two cache configurations
	 * @private
	 */
	private static configsMatch(config1: ICacheConfig, config2: ICacheConfig): boolean {
		return (
			config1.enabled === config2.enabled &&
			config1.ttl === config2.ttl &&
			config1.entityInfo.enabled === config2.entityInfo.enabled &&
			config1.entityInfo.ttl === config2.entityInfo.ttl &&
			config1.referenceFields.enabled === config2.referenceFields.enabled &&
			config1.referenceFields.ttl === config2.referenceFields.ttl &&
			config1.picklists.enabled === config2.picklists.enabled &&
			config1.picklists.ttl === config2.picklists.ttl
		);
	}

	/**
	 * Clear all cache instances
	 */
	public static clearInstances(): void {
		CacheService.instances.clear();
	}

	/**
	 * Get a value from the cache
	 */
	public async get<T>(key: string): Promise<T | undefined> {
		if (!this.config.enabled) return undefined;

		const value = await this.cache.get(key) as T | undefined;
		if (value !== undefined) {
			this.metrics.hits++;
			console.debug(`[${new Date().toISOString()}] Cache HIT for key: ${key}`);
		} else {
			this.metrics.misses++;
			console.debug(`[${new Date().toISOString()}] Cache MISS for key: ${key}`);
		}

		return value;
	}

	/**
	 * Set a value in the cache with optional TTL
	 */
	public async set(key: string, value: unknown, ttl?: number): Promise<void> {
		if (!this.config.enabled) return;

		if (value === undefined || value === null) {
			console.debug(`Skipping cache set for key ${key} - value is undefined/null`);
			return;
		}

		// If no TTL provided, use the default base TTL
		const effectiveTTL = (ttl ?? this.config.ttl) * 1000; // Convert to milliseconds
		await this.cache.set(key, value, effectiveTTL);
		console.debug(`Cache SET for key: ${key}, TTL: ${effectiveTTL}ms`);
	}

	/**
	 * Delete a value from the cache
	 */
	public async delete(key: string): Promise<boolean> {
		return this.cache.delete(key);
	}

	/**
	 * Clear all values from the cache
	 */
	public async clear(): Promise<void> {
		await this.cache.clear();
	}

	/**
	 * Generate a cache key for entity information
	 */
	public getEntityInfoKey(entityType: string): string {
		return `entity:${entityType}:info`;
	}

	/**
	 * Generate a cache key for reference field values
	 * Note: Keys are always lowercase for consistency
	 */
	public getReferenceKey(entityType: string): string {
		if (!entityType) {
			throw new Error('Cannot generate reference cache key: entityType is required');
		}
		const key = `${entityType.toLowerCase()}:reference:values`;
		console.debug(`Generated reference cache key for entity '${entityType}': ${key}`);
		return key;
	}

	/**
	 * Generate a cache key for picklist values
	 */
	public getPicklistKey(entityType: string, fieldName: string): string {
		return `picklist:${entityType}:${fieldName}`;
	}

	/**
	 * Check if entity information caching is enabled
	 */
	public isEntityInfoEnabled(): boolean {
		return this.config.enabled && this.config.entityInfo.enabled;
	}

	/**
	 * Check if reference field caching is enabled
	 */
	public isReferenceEnabled(): boolean {
		return this.config.enabled && this.config.referenceFields.enabled;
	}

	/**
	 * Check if picklist caching is enabled
	 */
	public isPicklistEnabled(): boolean {
		return this.config.enabled && this.config.picklists.enabled;
	}

	/**
	 * Get TTL for entity information
	 */
	public getEntityInfoTTL(): number {
		return this.config.entityInfo.ttl;
	}

	/**
	 * Get TTL for reference fields
	 */
	public getReferenceFieldTTL(): number {
		return this.config.referenceFields.ttl;
	}

	/**
	 * Get TTL for picklists
	 */
	public getPicklistTTL(): number {
		return this.config.picklists.ttl;
	}

	/**
	 * Get cache metrics
	 */
	public getMetrics(): { hits: number; misses: number } {
		return { ...this.metrics };
	}

	/**
	 * Clear all cache instances
	 * This should be called when credentials are updated
	 */
	public static clearAllInstances(): void {
		console.debug('Clearing all cache instances');
		for (const instance of CacheService.instances.values()) {
			instance.clear().catch(error => {
				console.warn('Failed to clear cache instance:', error);
			});
		}
		CacheService.instances.clear();
	}
}
