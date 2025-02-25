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
					type: 'condition' | 'group';
					field?: string;
					op?: string;
					value?: string;
					valueType?: 'string' | 'number' | 'boolean';
					udf?: boolean;
				};
				subgroup?: IFilterGroup;
			}>;
		}>;
	};
}
