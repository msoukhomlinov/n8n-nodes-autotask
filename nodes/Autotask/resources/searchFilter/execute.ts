import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { ISearchFilterBuilderInput } from '../../types/SearchFilter';
import { validateFilterInput, convertToAutotaskFilter } from '../../helpers/searchFilterBuilder';

interface RawFilterInput {
	group: Array<{
		op: 'and' | 'or';
		items: {
			itemType: Array<{
				field: string;
				op: string;
				value?: string;
				valueType?: 'string' | 'number' | 'boolean' | 'date';
				dateValue?: string;
				booleanValue?: boolean;
				udf?: boolean;
			}>;
		};
	}>;
}

export async function build(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	try {
		const operation = this.getNodeParameter('operation', 0) as string;
		const isDynamicBuild = operation === 'dynamicBuild';

		// For dynamic build, we can optionally get the entity type, though
		// we don't need it for the filtering logic itself
		if (isDynamicBuild) {
			const entityType = this.getNodeParameter('entityType', 0) as string;
			console.debug(`Building dynamic filter for entity type: ${entityType}`);
		}

		// Get the raw input from the node parameter
		let rawInput: RawFilterInput;
		try {
			rawInput = this.getNodeParameter('filter', 0) as RawFilterInput;

			// Basic validation of the filter structure
			if (!rawInput || !rawInput.group || !Array.isArray(rawInput.group)) {
				return [[{ json: { error: 'Invalid filter structure' } }]];
			}
		} catch (filterError) {
			return [[{ json: { error: 'Failed to get filter parameter', details: (filterError as Error).message } }]];
		}

		// Transform the filter input into the format expected by the Autotask API
		let input: ISearchFilterBuilderInput;
		try {
			input = {
				filter: {
					group: rawInput.group.map(group => {
						// Validate group structure
						if (!group.items || !group.items.itemType || !Array.isArray(group.items.itemType)) {
							throw new Error('Invalid group structure');
						}

						return {
							op: group.op,
							items: group.items.itemType.map(item => {
								// Determine the value based on valueType
								let itemValue: string | boolean | undefined;

								if (item.valueType === 'date' && item.dateValue !== undefined) {
									itemValue = item.dateValue;
								} else if (item.valueType === 'boolean' && item.booleanValue !== undefined) {
									itemValue = item.booleanValue;
								} else {
									itemValue = item.value;
								}

								return {
									itemType: {
										type: 'condition',
										field: item.field,
										op: item.op,
										value: itemValue,
										valueType: item.valueType,
										dateValue: item.dateValue,
										booleanValue: item.booleanValue,
										udf: item.udf
									}
								};
							})
						};
					})
				}
			};
		} catch (transformError) {
			return [[{ json: { error: 'Failed to transform filter input', details: (transformError as Error).message } }]];
		}

		// Validate and convert the filter
		try {
			validateFilterInput(input);
			const autotaskFilter = await convertToAutotaskFilter(input);

			// Return the filter as a stringified JSON
			return [[{ json: { advancedFilter: JSON.stringify(autotaskFilter) } }]];
		} catch (validationError) {
			return [[{ json: { error: 'Filter validation or conversion failed', details: (validationError as Error).message } }]];
		}
	} catch (error) {
		// Catch any unexpected errors
		return [[{ json: { error: 'Unexpected error in search filter', details: (error as Error).message } }]];
	}
}

// For the dynamicBuild operation, we'll reuse the same function
// since the filter structure is identical
export const dynamicBuild = build;
