import type { IExecuteFunctions } from 'n8n-workflow';
import type { FieldMeta } from '../helpers/aiHelper';
import type { ToolFilter } from './filter-builder';
import type { RecencyBuildResult } from './recency';
import type { LabelResolution, PendingLabelConfirmation } from '../helpers/label-resolution';

export interface ExecutorState {
	context: IExecuteFunctions;
	resource: string;
	operation: string;
	params: Record<string, unknown>;           // post-stripped, post-normalised
	readFields: FieldMeta[];
	writeFields: FieldMeta[];
	fieldValues: Record<string, unknown>;      // post-label-resolved write fields
	combinedFilters: ToolFilter[];
	effectiveLimit: number;
	effectiveOffset: number;
	effectiveReturnAll: boolean;
	recencyResult: RecencyBuildResult;         // never null — always assigned by buildRecencyFilters()
	labelResolutions: LabelResolution[];
	labelWarnings: string[];
	labelPendingConfirmations: PendingLabelConfirmation[];
	filterResolutions: LabelResolution[];
	filterWarnings: string[];
	correlationId: string | undefined;
	entityId: string;                          // '' when no ID — matches tool-executor.ts line ~608
	selectedColumns: string[];                 // parseFieldsParam never returns null
}
