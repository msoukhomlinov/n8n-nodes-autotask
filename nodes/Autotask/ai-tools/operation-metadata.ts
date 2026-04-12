export type OperationResponseKind =
	| 'item'
	| 'list'
	| 'mutation'
	| 'delete'
	| 'count'
	| 'slaHealthCheck'
	| 'summary';

export interface OperationMetadata {
	name: string;
	isWrite: boolean;
	label: string;
	supportsFilters: boolean;
	responseKind: OperationResponseKind;
	docsFragment: string;
}

const OPERATION_METADATA_LIST: OperationMetadata[] = [
	{
		name: 'get',
		isWrite: false,
		label: 'Get by ID',
		supportsFilters: false,
		responseKind: 'item',
		docsFragment: "Retrieve a single record by numeric 'id'.",
	},
	{
		name: 'whoAmI',
		isWrite: false,
		label: 'Who am I',
		supportsFilters: false,
		responseKind: 'item',
		docsFragment: 'Resolve the authenticated resource record.',
	},
	{
		name: 'getMany',
		isWrite: false,
		label: 'Get many (with filters)',
		supportsFilters: true,
		responseKind: 'list',
		docsFragment:
			'Search records with up to two filters (AND/OR via filter_logic). Use filter_field/filter_value. Supports name-based resolution for reference/picklist filter values.',
	},
	{
		name: 'getPosted',
		isWrite: false,
		label: 'Get posted time entries',
		supportsFilters: true,
		responseKind: 'list',
		docsFragment: 'Get posted time entries with optional filters.',
	},
	{
		name: 'getUnposted',
		isWrite: false,
		label: 'Get unposted time entries',
		supportsFilters: true,
		responseKind: 'list',
		docsFragment: 'Get unposted time entries with optional filters.',
	},
	{
		name: 'searchByDomain',
		isWrite: false,
		label: 'Search by domain',
		supportsFilters: false,
		responseKind: 'list',
		docsFragment: 'Search companies by domain string.',
	},
	{
		name: 'count',
		isWrite: false,
		label: 'Count',
		supportsFilters: true,
		responseKind: 'count',
		docsFragment: 'Count records matching optional filters.',
	},
	{
		name: 'create',
		isWrite: true,
		label: 'Create',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: 'Create a new record.',
	},
	{
		name: 'createIfNotExists',
		isWrite: true,
		label: 'Create If Not Exists (idempotent)',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment:
			'Idempotent create using dedup fields, with outcomes: created, skipped, updated, or not_found variants.',
	},
	{
		name: 'update',
		isWrite: true,
		label: 'Update',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: "Update a record by numeric 'id'. Provide only fields to change.",
	},
	{
		name: 'delete',
		isWrite: true,
		label: 'Delete',
		supportsFilters: false,
		responseKind: 'delete',
		docsFragment: "Delete a record by numeric 'id'.",
	},
	{
		name: 'moveToCompany',
		isWrite: true,
		label: 'Move contact to company',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: 'Move a contact to another company.',
	},
	{
		name: 'moveConfigurationItem',
		isWrite: true,
		label: 'Move configuration item (clone to company)',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: 'Clone a configuration item to a different company.',
	},
	{
		name: 'transferOwnership',
		isWrite: true,
		label: 'Transfer ownership',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: 'Transfer ownership from source resource to destination resource.',
	},
	{
		name: 'slaHealthCheck',
		isWrite: false,
		label: 'SLA health check',
		supportsFilters: false,
		responseKind: 'slaHealthCheck',
		docsFragment: "Run SLA health check for a ticket using 'id' or 'ticketNumber'.",
	},
	{
		name: 'summary',
		isWrite: false,
		label: 'Ticket summary',
		supportsFilters: false,
		responseKind: 'summary',
		docsFragment:
			"Get a compact ticket summary ('id' or 'ticketNumber' required). Computed values, child counts, relationships.",
	},
	{
		name: 'getByResource',
		isWrite: false,
		label: 'Get by resource',
		supportsFilters: false,
		responseKind: 'item',
		docsFragment:
			"Get record(s) for a specific resource. Provide 'resourceID' as a name or numeric ID (auto-resolved). Use for operations that are scoped to a parent resource rather than queried by their own ID.",
	},
	{
		name: 'getByYear',
		isWrite: false,
		label: 'Get by resource and year',
		supportsFilters: false,
		responseKind: 'item',
		docsFragment:
			"Get the time-off balance for a specific calendar year. Provide 'resourceID' (name or numeric ID, auto-resolved) and 'year' as an integer (e.g. 2024).",
	},
	{
		name: 'approve',
		isWrite: true,
		label: 'Approve time off request',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment: "Approve a pending time off request by numeric 'id'.",
	},
	{
		name: 'reject',
		isWrite: true,
		label: 'Reject time off request',
		supportsFilters: false,
		responseKind: 'mutation',
		docsFragment:
			"Reject a pending time off request by numeric 'id', with optional rejectReason.",
	},
];

export const OPERATION_METADATA: Readonly<Record<string, OperationMetadata>> = Object.freeze(
	Object.fromEntries(OPERATION_METADATA_LIST.map((operation) => [operation.name, operation])),
);

export const SUPPORTED_TOOL_OPERATIONS = OPERATION_METADATA_LIST.map((operation) => operation.name);

export const WRITE_OPERATIONS = OPERATION_METADATA_LIST
	.filter((operation) => operation.isWrite)
	.map((operation) => operation.name);

export function getOperationMetadata(operation: string): OperationMetadata | undefined {
	return OPERATION_METADATA[operation];
}

export function isWriteOperation(operation: string): boolean {
	return OPERATION_METADATA[operation]?.isWrite === true;
}
