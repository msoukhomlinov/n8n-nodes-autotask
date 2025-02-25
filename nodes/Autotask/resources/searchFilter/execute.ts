import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { ISearchFilterBuilderInput } from '../../types/SearchFilter';
import { validateFilterInput, convertToAutotaskFilter } from '../../helpers/searchFilterBuilder';

interface RawFilterInput {
	group: Array<{
		op: 'and' | 'or';
		items: {
			itemType: Array<{
				type: 'condition' | 'group';
				field?: string;
				op?: string;
				value?: string;
				valueType?: 'string' | 'number' | 'boolean';
				udf?: boolean;
			}>;
		};
	}>;
}

export const build = async function(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	// Get the raw input and transform it to the expected structure
	const rawInput = this.getNodeParameter('filter', 0) as RawFilterInput;
	const input: ISearchFilterBuilderInput = {
		filter: {
			group: rawInput.group.map(group => ({
				op: group.op,
				items: group.items.itemType.map(item => ({
					itemType: item
				}))
			}))
		}
	};

	// Debug logging
	console.log('Filter input:', JSON.stringify(input, null, 2));
	console.log('Has filter?', !!input.filter);
	console.log('Has group?', !!input.filter?.group);
	console.log('Group length:', input.filter?.group?.length);
	if (input.filter?.group?.length > 0) {
		console.log('First group:', JSON.stringify(input.filter.group[0], null, 2));
		console.log('First group items:', JSON.stringify(input.filter.group[0].items, null, 2));
	}

	validateFilterInput(input);
	const autotaskFilter = convertToAutotaskFilter(input);

	// Return the filter as a stringified JSON
	return [[{ json: { advancedFilter: JSON.stringify(autotaskFilter) } }]];
};
