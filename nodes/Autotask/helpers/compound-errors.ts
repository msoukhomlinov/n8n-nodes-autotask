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
