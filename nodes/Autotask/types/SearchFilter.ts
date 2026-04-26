export interface IFilterGroup {
	op: 'and' | 'or';
	items: Array<IFilterCondition | IFilterGroup>;
}

export interface IFilterCondition {
	field: string;
	op: string;
	value: string | number | boolean | Array<string | number>;
	isUdf?: boolean;
}

export interface ISearchFilterBuilderInput {
	filter: {
		group: Array<{
			op: 'and' | 'or';
			items: Array<{
				itemType: {
					type: 'condition';
					field: string;
					op: string;
					value?: string | boolean | Array<string | number>;
					dateValue?: string;
					isUtc?: boolean;
					booleanValue?: boolean;
					arrayValue?: string;
					valueType?: 'string' | 'number' | 'boolean' | 'date' | 'array';
					udf?: boolean;
				};
			}>;
		}>;
	};
}
