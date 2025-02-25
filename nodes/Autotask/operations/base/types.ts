import { OperationType } from '../../types/base/entity-types';

/**
 * Available write operations
 */
export const WRITE_OPERATIONS = [
	OperationType.CREATE,
	OperationType.UPDATE,
	OperationType.DELETE,
] as const;

/**
 * Available read operations
 */
export const READ_OPERATIONS = [
	OperationType.READ,
	OperationType.QUERY,
	OperationType.COUNT,
	OperationType.GET_ENTITY_INFO,
	OperationType.GET_FIELD_INFO,
] as const;

/**
 * Defines operations that can modify data
 */
export type WriteOperation = typeof WRITE_OPERATIONS[number];

/**
 * Defines operations that only read data
 */
export type ReadOperation = typeof READ_OPERATIONS[number];

/**
 * Re-export OperationType for convenience
 */
export { OperationType };
