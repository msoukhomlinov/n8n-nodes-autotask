/**
 * Common interfaces for batch processing used across webhook helper functions
 */

/**
 * Interface for batch processing options
 */
export interface IBatchOptions {
  /**
   * Maximum number of items per batch
   * @default 50
   */
  batchSize?: number;

  /**
   * Pause between processing batches (in milliseconds)
   * @default 0
   */
  batchPauseMs?: number;

  /**
   * Maximum number of concurrent operations (for API calls)
   * @default 10
   */
  concurrencyLimit?: number;

  /**
   * Whether to throw errors or return failure results
   * @default false
   */
  throwOnError?: boolean;

  /**
   * Maximum number of retry attempts for failed items
   * @default 3
   */
  maxRetries?: number;

  /**
   * Pause between retry attempts (in milliseconds)
   * @default 1000
   */
  retryPauseMs?: number;
}

/**
 * Interface for batch processing results
 */
export interface IBatchResult<T = number> {
  /**
   * Number of successfully processed items
   */
  success: number;

  /**
   * Number of failed items
   */
  failed: number;

  /**
   * IDs of failed items
   */
  failedIds: T[];

  /**
   * Additional error details for diagnostics (if available)
   */
  errors?: Record<string, unknown>[];
}
