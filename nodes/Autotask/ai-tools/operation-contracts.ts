import { getIdentifierPairConfig } from '../constants/resource-operations';

export interface OperationContract {
	requiredFields?: string[];
	forbiddenFields?: string[];
	xorGroups?: string[][];
}

type ResourceOperationContracts = Record<string, Record<string, OperationContract>>;

export interface OperationContractViolation {
	message: string;
	path?: string[];
}

export const OPERATION_CONTRACTS: ResourceOperationContracts = {
	'*': {
		get: {
			requiredFields: ['id'],
			forbiddenFields: [
				'filter_field',
				'filter_op',
				'filter_value',
				'filter_field_2',
				'filter_op_2',
				'filter_value_2',
				'filter_logic',
				'filtersJson',
				'recency',
				'recency_field',
				'since',
				'until',
				'returnAll',
				'offset',
			],
		},
		update: {
			requiredFields: ['id'],
		},
		delete: {
			requiredFields: ['id'],
		},
		approve: {
			requiredFields: ['id'],
		},
		reject: {
			requiredFields: ['id'],
		},
		getByResource: {
			requiredFields: ['resourceID'],
		},
		getByYear: {
			requiredFields: ['resourceID', 'year'],
		},
		listPicklistValues: {
			requiredFields: ['fieldId'],
		},
		describeOperation: {
			requiredFields: ['targetOperation'],
		},
	},
	ticket: {
		slaHealthCheck: {
			xorGroups: [['id', 'ticketNumber']],
		},
		summary: {
			xorGroups: [['id', 'ticketNumber']],
		},
	},
};

export function hasProvidedValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === 'string') return value.trim() !== '';
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'number') return Number.isFinite(value) && value > 0;
	return true;
}

function quoteFields(fields: string[]): string {
	return fields.map((field) => `'${field}'`).join(' or ');
}

function getXorMessage(resource: string, operation: string, fields: string[]): string {
	const idPairConfig = getIdentifierPairConfig(resource, operation);
	if (
		idPairConfig &&
		fields.length === 2 &&
		fields.includes('id') &&
		fields.includes(idPairConfig.altIdField)
	) {
		const entityLabel = resource.charAt(0).toUpperCase() + resource.slice(1);
		return (
			`Operation '${operation}' requires exactly one identifier: either 'id' (numeric ${entityLabel} ID) ` +
			`or '${idPairConfig.altIdField}' (format ${idPairConfig.altIdFormat}, e.g. ${idPairConfig.altIdExample}).`
		);
	}
	return `Operation '${operation}' requires exactly one of ${quoteFields(fields)}.`;
}

export function getOperationContract(resource: string, operation: string): OperationContract | null {
	const globalContract = OPERATION_CONTRACTS['*']?.[operation];
	const resourceContract = OPERATION_CONTRACTS[resource]?.[operation];
	if (!globalContract && !resourceContract) return null;

	return {
		requiredFields: [
			...new Set([...(globalContract?.requiredFields ?? []), ...(resourceContract?.requiredFields ?? [])]),
		],
		forbiddenFields: [
			...new Set([
				...(globalContract?.forbiddenFields ?? []),
				...(resourceContract?.forbiddenFields ?? []),
			]),
		],
		xorGroups: [...(globalContract?.xorGroups ?? []), ...(resourceContract?.xorGroups ?? [])],
	};
}

export function validateOperationContract(
	resource: string,
	operation: string,
	params: Record<string, unknown>,
): OperationContractViolation[] {
	const contract = getOperationContract(resource, operation);
	if (!contract) return [];

	const violations: OperationContractViolation[] = [];
	for (const field of contract.requiredFields ?? []) {
		if (!hasProvidedValue(params[field])) {
			violations.push({
				message: `Operation '${operation}' requires '${field}'.`,
				path: [field],
			});
		}
	}
	for (const field of contract.forbiddenFields ?? []) {
		if (hasProvidedValue(params[field])) {
			violations.push({
				message: `Operation '${operation}' does not allow '${field}'.`,
				path: [field],
			});
		}
	}
	for (const xorGroup of contract.xorGroups ?? []) {
		const provided = xorGroup.filter((field) => hasProvidedValue(params[field]));
		if (provided.length !== 1) {
			violations.push({
				message: getXorMessage(resource, operation, xorGroup),
				path: [...xorGroup],
			});
		}
	}

	return violations;
}

export function getOperationContractRuleText(resource: string, operation: string): string[] {
	const contract = getOperationContract(resource, operation);
	if (!contract) return [];

	const lines: string[] = [];
	for (const field of contract.requiredFields ?? []) {
		lines.push(`Requires '${field}'.`);
	}
	for (const field of contract.forbiddenFields ?? []) {
		lines.push(`Does not allow '${field}'.`);
	}
	for (const xorGroup of contract.xorGroups ?? []) {
		lines.push(getXorMessage(resource, operation, xorGroup));
	}

	return lines;
}

function assertContractRegistryConsistency(): void {
	for (const [resourceKey, ops] of Object.entries(OPERATION_CONTRACTS)) {
		for (const [opKey, contract] of Object.entries(ops)) {
			const required = new Set(contract.requiredFields ?? []);
			const forbidden = new Set(contract.forbiddenFields ?? []);
			for (const field of required) {
				if (forbidden.has(field)) {
					throw new Error(
						`operation-contracts: '${resourceKey}.${opKey}' has '${field}' in both requiredFields and forbiddenFields — this is a contradiction.`,
					);
				}
			}
			for (const group of contract.xorGroups ?? []) {
				if (group.length < 2) {
					throw new Error(
						`operation-contracts: '${resourceKey}.${opKey}' has an xorGroup with fewer than 2 members — XOR requires at least two fields.`,
					);
				}
			}
		}
	}
}

assertContractRegistryConsistency();
