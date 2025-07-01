import Keyv from 'keyv';
import KeyvFile from 'keyv-file';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
 * Uses file-based storage with TTL for automatic cleanup and persistence across restarts
 */
export class CacheService {
	private static instances: Map<string, CacheService> = new Map();
	private cache: Keyv<unknown>;
	private config: ICacheConfig;
	private namespace: string;
	private filePath?: string;
	private maxSizeMB?: number;
	private metrics: {
		hits: number;
		misses: number;
	} = { hits: 0, misses: 0 };
	private packageVersion: string;

	// -----------------------------------------------------------------------------
	// Helper – ANSI colour codes for improved console readability.
	// Colour support is widespread in modern terminals (including PowerShell Core),
	// and the codes gracefully degrade to plain text where colour is unsupported.
	// -----------------------------------------------------------------------------

	private static ANSI_RESET = '\x1b[0m';
	private static ANSI_GREEN = '\x1b[32m';
	private static ANSI_RED = '\x1b[31m';
	private static ANSI_YELLOW = '\x1b[33m';

	private constructor(config: ICacheConfig, credentialsId: string, cacheDir?: string, maxSizeMB?: number) {
		this.config = config;
		this.namespace = `autotask:${credentialsId}`;
		this.maxSizeMB = maxSizeMB;
		this.packageVersion = this.getPackageVersion();

		try {
			if (cacheDir) {
				// Ensure we have an absolute path
				const absoluteCacheDir = path.isAbsolute(cacheDir)
					? cacheDir
					: path.resolve(process.cwd(), cacheDir);

				// Create directory if it doesn't exist
				const credentialDir = path.join(absoluteCacheDir, this.sanitizeCredentialId(credentialsId));
				fs.mkdirSync(credentialDir, { recursive: true });

				// Create file-based Keyv instance
				const filePath = path.join(credentialDir, 'cache.json');

				this.cache = new Keyv({
					namespace: this.namespace,
					store: new KeyvFile({
						filename: filePath,
						writeDelay: 100,  // Small delay to batch writes
						expiredCheckDelay: 24 * 60 * 60 * 1000  // Check for expired items daily
					})
				});

				this.filePath = filePath;
				console.debug(`Created file-based cache at ${filePath}`);

				// Check if cache file exists and is readable
				if (fs.existsSync(filePath)) {
					try {
						const stats = fs.statSync(filePath);
						console.debug(`Cache file exists: ${filePath}, size: ${(stats.size / 1024).toFixed(2)} KB`);
					} catch (error) {
						console.warn(`Cache file exists but cannot be accessed: ${filePath}`, error);
					}
				} else {
					console.debug(`Cache file does not exist yet, will be created on first write: ${filePath}`);

					// Ensure parent directory exists and is writable
					try {
						fs.accessSync(credentialDir, fs.constants.W_OK);
						console.debug(`Cache directory is writable: ${credentialDir}`);
					} catch (error) {
						console.warn(`Cache directory is not writable: ${credentialDir}`, error);
					}
				}
			} else {
				throw new Error('Cache directory is required for file-based caching');
			}
		} catch (error) {
			console.error('Failed to create file-based cache:', error);
			throw new Error(`Failed to initialize cache: ${error.message}`);
		}

		// Log cache errors
		this.cache.on('error', (err) => console.error('Cache Error:', err));
		console.debug(`Created new cache instance for ${credentialsId} with config:`, {
			enabled: config.enabled,
			entityInfo: config.entityInfo,
			referenceFields: config.referenceFields,
			picklists: config.picklists,
			filePath: this.filePath,
			maxSizeMB: this.maxSizeMB,
			version: this.packageVersion
		});
	}

	/**
	 * Sanitize credential ID for use in filenames
	 */
	private sanitizeCredentialId(id: string): string {
		return id.replace(/[^a-zA-Z0-9]/g, '_');
	}

	/**
	 * Get the singleton instance of the cache service
	 */
	public static getInstance(
		config: ICacheConfig,
		credentialsId: string,
		cacheDir?: string,
		maxSizeMB?: number
	): CacheService {
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
			CacheService.instances.set(instanceKey, new CacheService(config, credentialsId, cacheDir, maxSizeMB));
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
	 * Check cache file size in MB
	 */
	public async checkSize(): Promise<number> {
		if (!this.filePath) {
			return 0;
		}

		try {
			// Check if file exists first
			if (!fs.existsSync(this.filePath)) {
				console.debug(`Cache file does not exist yet when checking size: ${this.filePath}`);
				return 0;
			}

			const stats = fs.statSync(this.filePath);
			return stats.size / (1024 * 1024); // Return size in MB
		} catch (error) {
			console.warn('Failed to check cache size:', error);
			return 0;
		}
	}

	/**
	 * Clean up cache if size exceeds limit
	 */
	private async cleanupIfNeeded(): Promise<void> {
		if (!this.maxSizeMB || this.maxSizeMB <= 0) return;

		const sizeMB = await this.checkSize();
		if (sizeMB > this.maxSizeMB) {
			console.debug(`Cache size (${sizeMB.toFixed(2)}MB) exceeds limit (${this.maxSizeMB}MB), cleaning up...`);
			await this.clear();
		}
	}

	/**
	 * Get a value from the cache
	 */
	public async get<T>(key: string): Promise<T | undefined> {
		if (!this.config.enabled) {
			console.debug(`Cache disabled, skipping get for key: ${key}`);
			return undefined;
		}

		const startTime = Date.now();
		try {
			const value = await this.cache.get(key) as T | undefined;
			const duration = Date.now() - startTime;

			if (duration > 200) {
				console.warn(`Slow cache get operation (${duration}ms) for key: ${key}`);
			}

			if (value !== undefined) {
				this.metrics.hits++;
				console.debug(`${CacheService.ANSI_GREEN}[CACHE HIT]${CacheService.ANSI_RESET} ${key} (${duration}ms)`);
			} else {
				this.metrics.misses++;
				console.debug(`${CacheService.ANSI_RED}[CACHE MISS]${CacheService.ANSI_RESET} ${key} (${duration}ms)`);

				// Check if cache file exists for additional troubleshooting information
				if (this.filePath && fs.existsSync(this.filePath)) {
					try {
						const fileContent = fs.readFileSync(this.filePath, 'utf8');
						const hasKey = fileContent.includes(key);
						console.debug(`  ↳ Cache file ${hasKey ? 'contains' : 'does not contain'} key`);
					} catch (error) {
						console.warn(`Failed to check cache file for key ${key}:`, error);
					}
				}
			}

			return value;
		} catch (error) {
			console.warn(`Cache get error for key ${key}:`, error);
			return undefined;
		}
	}

	/**
	 * Set a value in the cache with optional TTL
	 */
	public async set(key: string, value: unknown, ttl?: number): Promise<void> {
		if (!this.config.enabled) {
			console.debug(`Cache disabled, skipping set for key: ${key}`);
			return;
		}

		if (value === undefined || value === null) {
			console.debug(`Skipping cache set for key ${key} - value is undefined/null`);
			return;
		}

		try {
			// Check cache size before setting
			await this.cleanupIfNeeded();

			// If no TTL provided, use the default base TTL
			const effectiveTTL = (ttl ?? this.config.ttl) * 1000; // Convert to milliseconds

			const startTime = Date.now();
			try {
				await this.cache.set(key, value, effectiveTTL);
				const duration = Date.now() - startTime;

				if (duration > 200) {
					console.warn(`Slow cache set operation (${duration}ms) for key: ${key}`);
				}

				const ttlSeconds = Math.round(effectiveTTL / 1000);
				console.debug(`${CacheService.ANSI_YELLOW}[CACHE SET]${CacheService.ANSI_RESET} ${key} ttl=${ttlSeconds}s (${duration}ms)`);

				// Verify the file was updated
				if (this.filePath && fs.existsSync(this.filePath)) {
					const stats = fs.statSync(this.filePath);
					console.debug(`  ↳ Cache file after set: ${this.filePath}, size: ${(stats.size / 1024).toFixed(2)} KB`);
				}
			} catch (error) {
				console.warn(`Cache set error for key ${key}:`, error);
			}
		} catch (error) {
			// Don't let cache errors affect the main application flow
			console.warn(`Cache operation error for key ${key}:`, error);
		}
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
	 * Get the package version from package.json
	 */
	private getPackageVersion(): string {
		try {
			const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
			return packageJson.version;
		} catch (error) {
			console.warn('Failed to read package version:', error);
			return 'unknown';
		}
	}

	/**
	 * Create a versioned cache key
	 */
	private createVersionedKey(baseKey: string): string {
		return `v${this.packageVersion}:${baseKey}`;
	}

	/**
	 * Get the entity info cache key
	 */
	public getEntityInfoKey(entityType: string): string {
		const baseKey = `entity_info:${entityType}`;
		return this.createVersionedKey(baseKey);
	}

	/**
	 * Get the fields cache key
	 */
	public getFieldsKey(entityType: string, fieldType: string): string {
		const baseKey = `fields:${entityType}:${fieldType}`;
		return this.createVersionedKey(baseKey);
	}

	/**
	 * Get the reference cache key
	 * Note: Keys are always lowercase for consistency
	 */
	public getReferenceKey(entityType: string): string {
		if (!entityType) {
			throw new Error('Cannot generate reference cache key: entityType is required');
		}
		const baseKey = `reference:${entityType.toLowerCase()}`;
		const key = this.createVersionedKey(baseKey);
		console.debug(`Generated reference cache key for entity '${entityType}': ${key}`);
		return key;
	}

	/**
	 * Get the picklist cache key
	 */
	public getPicklistKey(entityType: string, fieldName: string): string {
		const baseKey = `picklist:${entityType}:${fieldName}`;
		return this.createVersionedKey(baseKey);
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

			// Also delete the cache file if it exists
			if (instance.filePath && fs.existsSync(instance.filePath)) {
				try {
					fs.unlinkSync(instance.filePath);
					console.debug(`Deleted cache file: ${instance.filePath}`);
				} catch (error) {
					console.warn(`Failed to delete cache file ${instance.filePath}:`, error);
				}
			}
		}
		CacheService.instances.clear();
	}
}
