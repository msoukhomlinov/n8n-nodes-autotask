import { OperationType } from '../../types/base/entity-types';
import { WRITE_OPERATIONS } from './types';
import type { WriteOperation } from './types';

/**
 * Validates operation types and provides operation-specific functionality
 */
export class OperationTypeValidator {
	/**
	 * Validate operation type
	 */
	async validateOperation(operation: string): Promise<boolean> {
		// Check if operation is supported
		if (!this.isSupportedOperation(operation)) {
			throw new Error(`Unsupported operation: ${operation}`);
		}

		// Operation is valid
		return true;
	}

	/**
	 * Check if operation is supported
	 */
	private isSupportedOperation(operation: string): operation is OperationType {
		return Object.values(OperationType).includes(operation as OperationType);
	}

	/**
	 * Check if operation is a write operation
	 */
	isWriteOperation(operation: string): boolean {
		return WRITE_OPERATIONS.includes(operation as WriteOperation);
	}
}
