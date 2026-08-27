import { getIdentifierPairConfig } from '../constants/resource-operations';

export interface OperationContract {
	requiredFields?: string[];
	forbiddenFields?: string[];
	xorGroups?: string[][];
	/**
	 * "At least one of" groups: the call is valid when AT LEAST ONE field in the
	 * group carries a value. Violation when NONE do (unlike xorGroups, providing
	 * several is fine). Used for signals where any single one makes the operation
	 * meaningful (e.g. company.searchByIdentity: companyName / email / website) —
	 * a call with no signal at all would otherwise run zero queries and still
	 * publish a coverage block (Codex NEW-3).
	 */
	anyOfGroups?: string[][];
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
	company: {
		searchByIdentity: {
			// All three identity signals are optional in the published schema (the
			// model may know any subset), but a call with NONE of them performs no
			// search and must be rejected before any query or coverage computation
			// (Codex NEW-3) — INVALID_FILTER_CONSTRAINT via validateOperationContract.
			anyOfGroups: [['companyName', 'email', 'website']],
		},
	},
	ticket: {
		slaHealthCheck: {
			xorGroups: [['id', 'ticketNumber']],
		},
		summary: {
			xorGroups: [['id', 'ticketNumber']],
			forbiddenFields: ['filter_field', 'filter_op', 'filter_value', 'filter_field_2', 'filter_op_2', 'filter_value_2'],
		},
		timeline: {
			xorGroups: [['id', 'ticketNumber']],
		},
		searchByKeyword: {
			requiredFields: ['keyword'],
			forbiddenFields: ['filter_field', 'filter_op', 'filter_value', 'filter_field_2', 'filter_op_2', 'filter_value_2', 'filter_logic', 'filtersJson', 'offset'],
		},
	},
};

export function hasProvidedValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === 'string') return value.trim() !== '';
	if (Array.isArray(value)) return value.length > 0;
	// Any finite number counts as provided — 0 is a valid filter value and a valid id
	// (the root Company record has id=0). value>0 wrongly dropped both.
	if (typeof value === 'number') return Number.isFinite(value);
	return true;
}

function quoteFields(fields: string[]): string {
	return fields.map((field) => `'${field}'`).join(' or ');
}

function getAnyOfMessage(resource: string, operation: string, fields: string[]): string {
	void resource;
	return `Operation '${operation}' requires at least one of ${quoteFields(fields)} — none were provided. Supply at least one signal and retry.`;
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
		anyOfGroups: [...(globalContract?.anyOfGroups ?? []), ...(resourceContract?.anyOfGroups ?? [])],
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
	for (const anyOfGroup of contract.anyOfGroups ?? []) {
		const provided = anyOfGroup.filter((field) => hasProvidedValue(params[field]));
		if (provided.length === 0) {
			violations.push({
				message: getAnyOfMessage(resource, operation, anyOfGroup),
				path: [...anyOfGroup],
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
	for (const anyOfGroup of contract.anyOfGroups ?? []) {
		lines.push(getAnyOfMessage(resource, operation, anyOfGroup));
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
			for (const group of contract.anyOfGroups ?? []) {
				if (group.length === 0) {
					throw new Error(
						`operation-contracts: '${resourceKey}.${opKey}' has an empty anyOfGroup — a group with no members can never be satisfied.`,
					);
				}
			}
		}
	}
}

assertContractRegistryConsistency();
