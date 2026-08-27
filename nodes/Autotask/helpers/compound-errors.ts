export class DedupFieldError extends Error {
	readonly entityType: string;
	readonly field: string;
	readonly reason: 'not-a-field' | 'no-value';

	constructor(
		entityType: string,
		field: string,
		reason: 'not-a-field' | 'no-value',
	) {
		super(
			reason === 'not-a-field'
				? `Dedup field '${field}' is not a field of ${entityType} — use describeFields to pick a real, queryable field.`
				: `No value supplied for dedup field '${field}' — supply a value or choose another field.`,
		);
		this.name = 'DedupFieldError';
		this.entityType = entityType;
		this.field = field;
		this.reason = reason;
	}
}

export class ParentNotFoundError extends Error {
	readonly entityLabel: string;
	readonly lookupField: string;
	readonly lookupValue: string | number;

	constructor(entityLabel: string, lookupField: string, lookupValue: string | number) {
		super(`${entityLabel} not found for ${lookupField} '${lookupValue}'. Verify the ID is correct.`);
		this.name = 'ParentNotFoundError';
		this.entityLabel = entityLabel;
		this.lookupField = lookupField;
		this.lookupValue = lookupValue;
	}
}
