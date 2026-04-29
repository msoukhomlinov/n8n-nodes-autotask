import type { IDataObject, IExecuteFunctions, IGetNodeParameterOptions } from 'n8n-workflow';
import { GetManyOperation } from '../operations/base';
import type { IAutotaskEntity } from '../types';
import type { IFilterCondition } from '../types/base/entity-types';
import { getFields } from './entity/api';

const MAX_DOMAIN_LIMIT = 100;
const DEFAULT_DOMAIN_LIMIT = 25;
const MAX_CONTACT_FALLBACK_LIMIT = 500;
const COMPANY_DOMAIN_FIELD_PRIORITY = [
	'webAddress',
	'webaddress',
	'website',
	'websiteUrl',
	'webSiteURL',
	'url',
	'domain',
] as const;

type DomainOperator = 'eq' | 'beginsWith' | 'endsWith' | 'contains';

interface DomainSearchOptions {
	domain: string;
	companyName?: string;
	domainOperator?: string;
	searchContactEmails?: boolean;
	limit?: number;
	itemIndex?: number;
	selectColumns?: string[];
}

interface IdentitySearchOptions {
	companyName?: string;
	email?: string;
	website?: string;
	limit?: number;
	itemIndex?: number;
	selectColumns?: string[];
}

interface CompanyFrequency extends IDataObject {
	companyId: number | string;
	companyName: string;
	count: number;
}

export interface CompanyDomainResultItem extends IDataObject {
	id: number | string | null;
	companyName: string | null;
	matchSource: 'companyWebsite' | 'contactEmailFallback';
	confidence: number;
	matchedField?: string | null;
	matchedValue?: string | null;
}

export interface UnresolvedSearchDirective extends IDataObject {
	nextAction: string;
	retryKey: string;
	recommendedFilters: string[];
	terminal: boolean;
	hint: string;
	suggestions: string[];
	helpfulOperations: string[];
}

export interface CompanyDomainSearchResult extends IDataObject {
	source: 'companyWebsite' | 'contactEmailFallback' | 'none';
	domainInput: string;
	domainNormalised: string;
	requestedOperator: string;
	appliedCompanyOperator: DomainOperator;
	searchContactEmails: boolean;
	count: number;
	results: CompanyDomainResultItem[];
	/** @deprecated Kept for backwards compatibility with 2.11.x consumers. Prefer results[0].companyName. */
	topCompanyName?: string;
	/** @deprecated Kept for backwards compatibility with 2.11.x consumers. Prefer results[0].id. */
	topCompanyId?: number | string | null;
	matchedContacts?: number;
	matchedCompanies?: number;
	companyFrequencies?: CompanyFrequency[];
	notes?: string[];
	unresolvedSearch?: UnresolvedSearchDirective;
}

export interface RankedCompanyCandidate extends IDataObject {
	confidence: number;
	confidenceReason: string;
	matchedSignals: string[];
}

export interface CompanyIdentitySearchResult extends IDataObject {
	source: 'rankedIdentity' | 'none';
	companyNameInput?: string;
	emailInput?: string;
	websiteInput?: string;
	domainNormalised: string;
	count: number;
	results: RankedCompanyCandidate[];
	notes?: string[];
}

interface RetryTrackerEntry {
	identifierSignature: string;
	attempts: number;
	lastSeenAt: number;
}

const RETRY_TRACK_TTL_MS = 15 * 60 * 1000;
const RETRY_TRACK_MAX_ENTRIES = 300;
const unresolvedRetryTracker = new Map<string, RetryTrackerEntry>();

function clampLimit(limit: number | undefined, fallback = DEFAULT_DOMAIN_LIMIT): number {
	if (typeof limit !== 'number' || Number.isNaN(limit)) return fallback;
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_DOMAIN_LIMIT);
}

function normaliseDomainInput(value: string): string {
	let normalised = value.trim().toLowerCase();
	normalised = normalised.replace(/^https?:\/\//i, '');
	normalised = normalised.replace(/^www\./i, '');
	normalised = normalised.replace(/\/+$/, '');
	const slashIndex = normalised.indexOf('/');
	if (slashIndex >= 0) {
		normalised = normalised.slice(0, slashIndex);
	}
	const hashIndex = normalised.indexOf('#');
	if (hashIndex >= 0) {
		normalised = normalised.slice(0, hashIndex);
	}
	const queryIndex = normalised.indexOf('?');
	if (queryIndex >= 0) {
		normalised = normalised.slice(0, queryIndex);
	}
	if (normalised.includes('@')) {
		const [, domainPart] = normalised.split('@');
		if (domainPart) normalised = domainPart;
	}
	normalised = normalised.replace(/:\d+$/, '');
	return normalised;
}

function normaliseNameInput(value: string | undefined): string {
	return (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

function normaliseOperator(operator: string | undefined): DomainOperator {
	const lower = (operator ?? 'contains').trim().toLowerCase();
	if (lower === 'like') return 'contains';
	if (lower === 'eq' || lower === 'beginswith' || lower === 'endswith' || lower === 'contains') {
		if (lower === 'beginswith') return 'beginsWith';
		if (lower === 'endswith') return 'endsWith';
		return lower as DomainOperator;
	}
	return 'contains';
}

function applyTextOperator(value: string, operator: DomainOperator, search: string): boolean {
	const left = value.toLowerCase();
	const right = search.toLowerCase();
	switch (operator) {
		case 'eq':
			return left === right;
		case 'beginsWith':
			return left.startsWith(right);
		case 'endsWith':
			return left.endsWith(right);
		case 'contains':
			return left.includes(right);
		default:
			return false;
	}
}

function buildWebsiteFieldList(companyFieldNames: string[]): string[] {
	const lowerLookup = new Map(companyFieldNames.map((name) => [name.toLowerCase(), name]));
	const ordered: string[] = [];
	for (const field of COMPANY_DOMAIN_FIELD_PRIORITY) {
		const match = lowerLookup.get(field.toLowerCase());
		if (match && !ordered.includes(match)) {
			ordered.push(match);
		}
	}
	for (const name of companyFieldNames) {
		const lower = name.toLowerCase();
		if (ordered.includes(name)) continue;
		if (/(web|website|url|domain)/i.test(lower)) {
			ordered.push(name);
		}
	}
	return ordered;
}

async function runBoundedQuery(
	context: IExecuteFunctions,
	entityType: string,
	itemIndex: number,
	limit: number,
	filters: IFilterCondition[],
	selectColumns: string[],
): Promise<IAutotaskEntity[]> {
	const originalGetNodeParameter = context.getNodeParameter.bind(context);
	context.getNodeParameter = ((
		name: string,
		index: number,
		fallbackValue?: unknown,
		options?: IGetNodeParameterOptions,
	): unknown => {
		if (name === 'returnAll') return false;
		if (name === 'maxRecords') return limit;
		if (name === 'selectColumns') return selectColumns;
		if (name === 'selectColumnsJson') return JSON.stringify(selectColumns);
		return originalGetNodeParameter(name, index, fallbackValue, options);
	}) as typeof context.getNodeParameter;

	try {
		const getManyOp = new GetManyOperation<IAutotaskEntity>(entityType, context);
		const results = await getManyOp.execute({ filter: filters, MaxRecords: limit }, itemIndex);
		return results.slice(0, limit);
	} finally {
		context.getNodeParameter = originalGetNodeParameter;
	}
}

function isValidCompanyId(value: unknown): value is string | number {
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value === 'string') return value.trim() !== '';
	return false;
}

function buildRetryKey(domain: string, companyName: string, operator: DomainOperator): string {
	return `company.searchByDomain:domain=${domain || '-'}|name=${companyName || '-'}|operator=${operator}`;
}

function cleanupRetryTracker(now: number): void {
	for (const [key, entry] of unresolvedRetryTracker) {
		if (now - entry.lastSeenAt > RETRY_TRACK_TTL_MS) {
			unresolvedRetryTracker.delete(key);
		}
	}
	if (unresolvedRetryTracker.size <= RETRY_TRACK_MAX_ENTRIES) return;
	const orderedByAge = Array.from(unresolvedRetryTracker.entries())
		.sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
	const overflow = unresolvedRetryTracker.size - RETRY_TRACK_MAX_ENTRIES;
	for (let i = 0; i < overflow; i++) {
		unresolvedRetryTracker.delete(orderedByAge[i][0]);
	}
}

function buildUnresolvedDirective(
	domainNormalised: string,
	companyNameNormalised: string,
	appliedCompanyOperator: DomainOperator,
): UnresolvedSearchDirective {
	const retryKey = buildRetryKey(domainNormalised, companyNameNormalised, appliedCompanyOperator);
	const identifierSignature = `${domainNormalised}|${companyNameNormalised}`;
	const now = Date.now();
	cleanupRetryTracker(now);

	const existing = unresolvedRetryTracker.get(retryKey);
	let attempts = 1;
	if (existing && existing.identifierSignature === identifierSignature) {
		attempts = existing.attempts + 1;
	}

	unresolvedRetryTracker.set(retryKey, {
		identifierSignature,
		attempts,
		lastSeenAt: now,
	});

	const terminal = attempts >= 2;
	if (terminal) {
		return {
			nextAction:
				'Stop retrying this identical company domain search. Ask the user for at least one new disambiguator (exact company name, alternate domain, city, or phone) before retrying.',
			retryKey,
			recommendedFilters: ['companyName:eq:<exact name>', 'phone:contains:<digits>', 'city:eq:<city>'],
			terminal: true,
			hint: 'Repeated unresolved search with identical identifiers. Additional input is required.',
			suggestions: [
				'Collect an exact legal company name and retry with companyName + domain.',
				'Ask for an alternate domain (for example billing/helpdesk subdomain).',
				'Use another identifier like city, phone, or account number.',
			],
			helpfulOperations: ['company.getMany', 'contact.getMany'],
		};
	}

	return {
		nextAction:
			'Do not immediately retry the same query. Retry once with additional filters (for example exact company name or city) or ask the user for more identifying details.',
		retryKey,
		recommendedFilters: ['companyName:eq:<exact name>', 'city:eq:<city>', 'phone:contains:<digits>'],
		terminal: false,
		hint: 'No company match found. Provide additional disambiguation before retrying.',
		suggestions: [
			'Provide an exact company name if known.',
			'Try an alternate domain variation.',
			'Add a location or phone-based filter.',
		],
		helpfulOperations: ['company.getMany', 'contact.getMany'],
	};
}

export async function searchCompaniesByDomain(
	context: IExecuteFunctions,
	options: DomainSearchOptions,
): Promise<CompanyDomainSearchResult> {
	const itemIndex = options.itemIndex ?? 0;
	const domainInput = options.domain;
	const companyNameNormalised = normaliseNameInput(options.companyName);
	const domainNormalised = normaliseDomainInput(domainInput);
	const requestedOperator = options.domainOperator ?? 'contains';
	const requestedNormalisedOperator = normaliseOperator(requestedOperator);
	const limit = clampLimit(options.limit);
	const searchContactEmails = options.searchContactEmails !== false && (options.searchContactEmails as unknown) !== 0;
	const notes: string[] = [];

	if (!domainNormalised) {
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator: 'contains',
			searchContactEmails,
			count: 0,
			results: [],
			notes: ['Domain is empty after normalisation.'],
			unresolvedSearch: buildUnresolvedDirective(domainNormalised, companyNameNormalised, 'contains'),
		};
	}

	const companyFields = await getFields('company', context, { fieldType: 'standard' });
	const companyFieldNames = companyFields.map((field) => field.name);
	const websiteFields = buildWebsiteFieldList(companyFieldNames);
	if (websiteFields.length === 0) {
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator: 'contains',
			searchContactEmails,
			count: 0,
			results: [],
			notes: ['No company website/domain field was detected in entity metadata.'],
		};
	}

	let appliedCompanyOperator = requestedNormalisedOperator;
	if (requestedNormalisedOperator === 'eq') {
		appliedCompanyOperator = 'contains';
		notes.push(
			"Requested operator 'eq' was mapped to 'contains' for company website fields because Autotask stores full URLs (for example https://...).",
		);
	}

	const companyFilterItems = websiteFields.map((fieldName) => ({
		field: fieldName,
		op: appliedCompanyOperator,
		value: domainNormalised,
	}));
	const companyFilters =
		companyFilterItems.length === 1
			? companyFilterItems
			: [{ op: 'or', items: companyFilterItems }];
	const userSelectColumns = options.selectColumns ?? [];
	// If user specified columns, merge with websiteFields so matching still works.
	// If no columns (default), pass [] → API returns all fields.
	const queryColumns =
		userSelectColumns.length > 0
			? Array.from(new Set([...userSelectColumns, 'id', ...websiteFields]))
			: [];
	const companyResults = await runBoundedQuery(
		context,
		'company',
		itemIndex,
		limit,
		companyFilters,
		queryColumns,
	);

	const enrichedResults: CompanyDomainResultItem[] = companyResults.map((company) => {
		let matchedField: string | null = null;
		let matchedValue: string | null = null;
		for (const fieldName of websiteFields) {
			const raw = company[fieldName];
			if (typeof raw !== 'string' || raw.trim() === '') continue;
			if (applyTextOperator(raw, appliedCompanyOperator, domainNormalised)) {
				matchedField = fieldName;
				matchedValue = raw;
				break;
			}
		}

		let resultEntity: IDataObject;
		if (userSelectColumns.length === 0) {
			resultEntity = { ...company };
		} else {
			resultEntity = { id: (company.id as number | string | undefined) ?? null };
			for (const col of userSelectColumns) {
				if (col in company) resultEntity[col] = company[col];
			}
		}

		return {
			...resultEntity,
			id: (company.id as number | string | undefined) ?? null,
			companyName:
				typeof company.companyName === 'string' && company.companyName.trim() !== ''
					? company.companyName
					: null,
			matchSource: 'companyWebsite',
			confidence: 1,
			matchedField,
			matchedValue,
		};
	});

	if (enrichedResults.length > 0) {
		return {
			source: 'companyWebsite',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: enrichedResults.length,
			results: enrichedResults,
			...(notes.length > 0 ? { notes } : {}),
		};
	}

	if (!searchContactEmails) {
		notes.push('No company website/domain records matched and contact email fallback is disabled.');
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
		};
	}

	let contactOperator: DomainOperator = requestedNormalisedOperator;
	let contactValue = domainNormalised;
	if (requestedNormalisedOperator === 'eq') {
		contactOperator = 'endsWith';
		contactValue = `@${domainNormalised}`;
		notes.push(
			"Requested contact fallback operator 'eq' was mapped to 'endsWith' using '@domain'.",
		);
	}

	const contactLimit = Math.min(Math.max(limit * 10, 50), MAX_CONTACT_FALLBACK_LIMIT);
	const contactFilters = [
		{
			field: 'emailAddress',
			op: contactOperator,
			value: contactValue,
		},
	];
	const contactResults = await runBoundedQuery(
		context,
		'contact',
		itemIndex,
		contactLimit,
		contactFilters,
		['id', 'companyID', 'companyName', 'emailAddress'],
	);

	const companyFrequencyById = new Map<string, { companyId: string | number; count: number }>();
	for (const contact of contactResults) {
		const companyIdRaw = contact.companyID;
		if (!isValidCompanyId(companyIdRaw)) continue;
		const key = String(companyIdRaw);
		const current = companyFrequencyById.get(key);
		if (current) {
			current.count += 1;
		} else {
			companyFrequencyById.set(key, { companyId: companyIdRaw, count: 1 });
		}
	}

	if (companyFrequencyById.size === 0) {
		notes.push('No contacts with a valid companyID were found for the supplied domain.');
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			matchedContacts: contactResults.length,
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
		};
	}

	const companyIds = Array.from(companyFrequencyById.values()).map((entry) => entry.companyId);
	const resolvedCompanies = await runBoundedQuery(
		context,
		'company',
		itemIndex,
		Math.min(companyIds.length, MAX_CONTACT_FALLBACK_LIMIT),
		[
			{
				field: 'id',
				op: 'in',
				value: companyIds,
			},
		],
		['id', 'companyName'],
	);

	const companyNameById = new Map<string, string>();
	for (const company of resolvedCompanies) {
		if (!isValidCompanyId(company.id)) continue;
		const companyName = company.companyName;
		if (typeof companyName === 'string' && companyName.trim() !== '') {
			companyNameById.set(String(company.id), companyName.trim());
		}
	}

	const companyFrequencies: CompanyFrequency[] = [];
	for (const { companyId, count } of companyFrequencyById.values()) {
		const companyName = companyNameById.get(String(companyId));
		if (!companyName) continue;
		companyFrequencies.push({
			companyId,
			companyName,
			count,
		});
	}

	companyFrequencies.sort((a, b) => {
		const countDiff = (b.count as number) - (a.count as number);
		if (countDiff !== 0) return countDiff;
		return String(a.companyName).localeCompare(String(b.companyName), 'en-AU');
	});

	if (companyFrequencies.length === 0) {
		notes.push(
			'Contacts matched, but no canonical company names could be resolved from companyID values.',
		);
		return {
			source: 'none',
			domainInput,
			domainNormalised,
			requestedOperator,
			appliedCompanyOperator,
			searchContactEmails,
			count: 0,
			results: [],
			matchedContacts: contactResults.length,
			matchedCompanies: resolvedCompanies.length,
			notes,
			unresolvedSearch: buildUnresolvedDirective(
				domainNormalised,
				companyNameNormalised,
				appliedCompanyOperator,
			),
		};
	}

	const topCompany = companyFrequencies[0];
	const topCount = topCompany.count as number;
	const fallbackResults: CompanyDomainResultItem[] = companyFrequencies
		.slice(0, limit)
		.map((companyFrequency) => ({
			id: companyFrequency.companyId as string | number,
			companyName: companyFrequency.companyName as string,
			matchSource: 'contactEmailFallback',
			confidence: Math.max(
				0.01,
				Number(((companyFrequency.count as number) / Math.max(topCount, 1)).toFixed(4)),
			),
			matchedField: 'emailAddress',
			matchedValue: `@${domainNormalised}`,
		}));

	return {
		source: 'contactEmailFallback',
		domainInput,
		domainNormalised,
		requestedOperator,
		appliedCompanyOperator,
		searchContactEmails,
		count: fallbackResults.length,
		results: fallbackResults,
		topCompanyName: topCompany.companyName as string,
		topCompanyId: topCompany.companyId as string | number,
		matchedContacts: contactResults.length,
		matchedCompanies: resolvedCompanies.length,
		companyFrequencies,
		...(notes.length > 0 ? { notes } : {}),
	};
}

function scoreCompanyCandidate(
	company: IDataObject,
	nameNeedle: string,
	domainNeedle: string,
	websiteFields: string[],
): RankedCompanyCandidate {
	let confidence = 0;
	const matchedSignals: string[] = [];
	let confidenceReason = 'Low confidence';

	if (domainNeedle) {
		for (const fieldName of websiteFields) {
			const raw = company[fieldName];
			if (typeof raw !== 'string' || raw.trim() === '') continue;
			const fieldDomain = normaliseDomainInput(raw);
			if (!fieldDomain) continue;
			if (fieldDomain === domainNeedle) {
				confidence += 90;
				matchedSignals.push(`domainExact:${fieldName}`);
				confidenceReason = 'Exact domain match on company website field';
				break;
			}
			if (fieldDomain.includes(domainNeedle) || domainNeedle.includes(fieldDomain)) {
				confidence += 70;
				matchedSignals.push(`domainPartial:${fieldName}`);
				confidenceReason = 'Partial domain match on company website field';
				break;
			}
		}
	}

	const companyName =
		typeof company.companyName === 'string' ? company.companyName.toLowerCase() : '';
	if (nameNeedle && companyName.includes(nameNeedle)) {
		confidence += companyName === nameNeedle ? 60 : 40;
		matchedSignals.push('companyNameContains');
		if (!domainNeedle) {
			confidenceReason =
				companyName === nameNeedle ? 'Exact company name match' : 'Company name contains match';
		}
	}

	return {
		...company,
		confidence,
		confidenceReason,
		matchedSignals,
	};
}

export async function searchCompaniesByIdentity(
	context: IExecuteFunctions,
	options: IdentitySearchOptions,
): Promise<CompanyIdentitySearchResult> {
	const itemIndex = options.itemIndex ?? 0;
	const limit = clampLimit(options.limit);
	const companyNameInput = options.companyName?.trim() ?? '';
	const emailInput = options.email?.trim() ?? '';
	const websiteInput = options.website?.trim() ?? '';
	const notes: string[] = [];

	const domainFromEmail = emailInput ? normaliseDomainInput(emailInput) : '';
	const domainFromWebsite = websiteInput ? normaliseDomainInput(websiteInput) : '';
	const domainNormalised = domainFromWebsite || domainFromEmail;

	const userSelectColumns = options.selectColumns ?? [];
	const companyFields = await getFields('company', context, { fieldType: 'standard' });
	const websiteFields = buildWebsiteFieldList(companyFields.map((field) => field.name));
	const selectColumns =
		userSelectColumns.length > 0
			? Array.from(new Set([...userSelectColumns, 'id', 'companyName', ...websiteFields]))
			: [];

	const candidatesById = new Map<string, IDataObject>();

	if (domainNormalised) {
		const domainResults = await searchCompaniesByDomain(context, {
			domain: domainNormalised,
			companyName: companyNameInput || undefined,
			domainOperator: 'contains',
			searchContactEmails: true,
			limit,
			itemIndex,
			selectColumns,
		});

		if (domainResults.source === 'companyWebsite' && domainResults.results.length > 0) {
			for (const result of domainResults.results) {
				const id = result.id;
				if (!isValidCompanyId(id)) continue;
				candidatesById.set(String(id), result);
			}
		} else if (domainResults.source === 'contactEmailFallback') {
			notes.push(
				'Domain matched contacts but not a direct company website field; lowering confidence.',
			);
			for (const entry of domainResults.companyFrequencies ?? []) {
				if (!isValidCompanyId(entry.companyId)) continue;
				candidatesById.set(String(entry.companyId), {
					id: entry.companyId,
					companyName: entry.companyName,
					contactMatchCount: entry.count,
				});
			}
		}
	}

	const hasConfidentDomainMatch = Array.from(candidatesById.values()).length > 0;
	if (companyNameInput) {
		if (hasConfidentDomainMatch) {
			notes.push('Company name search also executed to enrich ranking among domain candidates.');
		} else {
			notes.push('No confident domain match found; using company name contains search.');
		}
		const nameResults = await runBoundedQuery(
			context,
			'company',
			itemIndex,
			Math.min(Math.max(limit * 2, 25), MAX_CONTACT_FALLBACK_LIMIT),
			[{ field: 'companyName', op: 'contains', value: companyNameInput }],
			selectColumns,
		);
		for (const result of nameResults) {
			const id = result.id;
			if (!isValidCompanyId(id)) continue;
			const key = String(id);
			const existing = candidatesById.get(key);
			candidatesById.set(key, existing ? { ...existing, ...result } : result);
		}
	}

	const nameNeedle = companyNameInput.toLowerCase();
	const rankedResults = Array.from(candidatesById.values())
		.map((candidate) =>
			scoreCompanyCandidate(candidate, nameNeedle, domainNormalised, websiteFields),
		)
		.sort((a, b) => {
			const scoreDiff = (b.confidence as number) - (a.confidence as number);
			if (scoreDiff !== 0) return scoreDiff;
			return String(a.companyName ?? '').localeCompare(String(b.companyName ?? ''), 'en-US');
		})
		.slice(0, limit);

	if (rankedResults.length === 0) {
		return {
			source: 'none',
			companyNameInput: companyNameInput || undefined,
			emailInput: emailInput || undefined,
			websiteInput: websiteInput || undefined,
			domainNormalised,
			count: 0,
			results: [],
			notes: ['No candidates found from identity signals.', ...notes],
		};
	}

	return {
		source: 'rankedIdentity',
		companyNameInput: companyNameInput || undefined,
		emailInput: emailInput || undefined,
		websiteInput: websiteInput || undefined,
		domainNormalised,
		count: rankedResults.length,
		results: rankedResults,
		...(notes.length > 0 ? { notes } : {}),
	};
}
