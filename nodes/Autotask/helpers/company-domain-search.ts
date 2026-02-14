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
    domainOperator?: string;
    searchContactEmails?: boolean;
    limit?: number;
    itemIndex?: number;
}

interface CompanySummary extends IDataObject {
    id: number | string | null;
    companyName: string | null;
    matchedField: string | null;
    matchedValue: string | null;
    website: string | null;
}

interface CompanyFrequency extends IDataObject {
    companyId: number | string;
    companyName: string;
    count: number;
}

export interface CompanyDomainSearchResult extends IDataObject {
    source: 'companyWebsite' | 'contactEmailFallback' | 'none';
    domainInput: string;
    domainNormalised: string;
    requestedOperator: string;
    appliedCompanyOperator: DomainOperator;
    searchContactEmails: boolean;
    count: number;
    results: CompanySummary[];
    topCompanyName?: string;
    topCompanyId?: number | string | null;
    matchedContacts?: number;
    matchedCompanies?: number;
    companyFrequencies?: CompanyFrequency[];
    notes?: string[];
}

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

export async function searchCompaniesByDomain(
    context: IExecuteFunctions,
    options: DomainSearchOptions,
): Promise<CompanyDomainSearchResult> {
    const itemIndex = options.itemIndex ?? 0;
    const domainInput = options.domain;
    const domainNormalised = normaliseDomainInput(domainInput);
    const requestedOperator = options.domainOperator ?? 'contains';
    const requestedNormalisedOperator = normaliseOperator(requestedOperator);
    const limit = clampLimit(options.limit);
    const searchContactEmails = options.searchContactEmails !== false;
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
    const companyFilters = companyFilterItems.length === 1
        ? companyFilterItems
        : [{ op: 'or', items: companyFilterItems }];
    const companySelectColumns = Array.from(new Set(['id', 'companyName', ...websiteFields]));
    const companyResults = await runBoundedQuery(
        context,
        'company',
        itemIndex,
        limit,
        companyFilters,
        companySelectColumns,
    );

    const summarisedCompanies: CompanySummary[] = companyResults.map((company) => {
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
        const firstWebsite = websiteFields
            .map((field) => company[field])
            .find((value) => typeof value === 'string' && value.trim() !== '') as string | undefined;
        return {
            id: (company.id as number | string | undefined) ?? null,
            companyName: (company.companyName as string | undefined) ?? null,
            matchedField,
            matchedValue,
            website: firstWebsite ?? null,
        };
    });

    if (summarisedCompanies.length > 0) {
        return {
            source: 'companyWebsite',
            domainInput,
            domainNormalised,
            requestedOperator,
            appliedCompanyOperator,
            searchContactEmails,
            count: summarisedCompanies.length,
            results: summarisedCompanies,
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
        };
    }

    let contactOperator: DomainOperator = requestedNormalisedOperator;
    let contactValue = domainNormalised;
    if (requestedNormalisedOperator === 'eq') {
        contactOperator = 'endsWith';
        contactValue = `@${domainNormalised}`;
        notes.push("Requested contact fallback operator 'eq' was mapped to 'endsWith' using '@domain'.");
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
        notes.push('Contacts matched, but no canonical company names could be resolved from companyID values.');
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
        };
    }

    const topCompany = companyFrequencies[0];
    return {
        source: 'contactEmailFallback',
        domainInput,
        domainNormalised,
        requestedOperator,
        appliedCompanyOperator,
        searchContactEmails,
        count: 1,
        results: [],
        topCompanyName: topCompany.companyName as string,
        topCompanyId: topCompany.companyId as string | number,
        matchedContacts: contactResults.length,
        matchedCompanies: resolvedCompanies.length,
        companyFrequencies,
        ...(notes.length > 0 ? { notes } : {}),
    };
}
