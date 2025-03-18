export interface IFilterGroup {
	op: 'and' | 'or';
	items: Array<IFilterCondition | IFilterGroup>;
}

export interface IFilterCondition {
	field: string;
	op: string;
	value: string | number | boolean;
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
					value?: string | boolean;
					dateValue?: string;
					booleanValue?: boolean;
					valueType?: 'string' | 'number' | 'boolean' | 'date';
					udf?: boolean;
				};
			}>;
		}>;
	};
}
