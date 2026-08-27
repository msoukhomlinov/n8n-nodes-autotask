import { type LabelResolution, type PendingLabelConfirmation } from '../helpers/label-resolution';
import { ERROR_TYPES, wrapError } from './error-formatter';
import { traceWriteGuard } from './debug-trace';

export function isResolutionFailureWarning(w: string): boolean {
    return (
        w.startsWith('[INFRASTRUCTURE]') ||
        w.includes('resolution failed') ||
        w.includes('resolution error') ||
        w.includes('Proceeding with raw values') ||
        w.includes('Could not resolve') ||
        w.includes('has no known entity type')
    );
}

export function summariseResolutionState(
    resolutions: LabelResolution[],
    warnings: string[],
    pendingConfirmations: PendingLabelConfirmation[],
): Record<string, unknown> {
    const warningKinds = warnings.map((warning) =>
        warning.startsWith('[INFRASTRUCTURE]') ? 'infrastructure' : 'resolution',
    );
    return {
        resolvedFields: Array.from(new Set(resolutions.map((r) => r.field))),
        failedFields: Array.from(
            new Set(
                warnings
                    .filter((w) => isResolutionFailureWarning(w))
                    .map((w) => {
                        const fieldMatch = w.match(/field '([^']+)'/);
                        return fieldMatch ? fieldMatch[1] : '[unknown]';
                    }),
            ),
        ),
        pendingConfirmationFields: Array.from(new Set(pendingConfirmations.map((p) => p.field))),
        warningKinds: Array.from(new Set(warningKinds)),
        warningCount: warnings.length,
        pendingConfirmationCount: pendingConfirmations.length,
    };
}

export function buildWriteResolutionBlocker(
    resource: string,
    operation: string,
    pendingConfirmations: PendingLabelConfirmation[],
    warnings: string[],
    impersonationFailed: boolean,
): string | null {
    const unresolvedWarnings = warnings.filter(
        (w) =>
            isResolutionFailureWarning(w) &&
            !w.startsWith('[INFRASTRUCTURE]') &&
            !w.includes('impersonation'),
    );
    // Partition (v2.28.5): picklist value mismatches (tagged [PICKLIST_MISMATCH]
    // by the write-path resolver) classify as INVALID_PICKLIST_VALUE with the
    // listPicklistValues retry directive; everything else stays
    // WRITE_RESOLUTION_INCOMPLETE.
    const infraErrors = warnings.filter((w) => w.startsWith('[INFRASTRUCTURE]'));
    // v2.28.9 r7 (C1/N2): a field whose picklist lookup failed with an infrastructure
    // error was NEVER validated. The resolver suppresses its [PICKLIST_MISMATCH] on
    // lookup failure; this is the defensive second line — drop any that still arrive
    // here so the blocker keeps the infrastructure-oriented classification and
    // invalidPicklistValues never lists an unvalidated value. Dropped mismatches join
    // neither bucket (they add no listPicklistValues / describeFields directive; the
    // outage is carried by ctx.infraErrors).
    const infraFailedFields = new Set(
        infraErrors
            .map((w) => w.match(/field '([^']+)'/)?.[1])
            .filter((f): f is string => typeof f === 'string'),
    );
    const infraDroppedMismatch = (w: string): boolean => {
        if (!w.startsWith('[PICKLIST_MISMATCH]')) return false;
        const fieldMatch = w.match(/field '([^']+)'/);
        return fieldMatch !== null && infraFailedFields.has(fieldMatch[1]);
    };
    const picklistMismatchWarnings = unresolvedWarnings.filter(
        (w) => w.startsWith('[PICKLIST_MISMATCH]') && !infraDroppedMismatch(w),
    );
    const referenceStyleFailures = unresolvedWarnings.filter(
        (w) => !w.startsWith('[PICKLIST_MISMATCH]') && !infraDroppedMismatch(w),
    );
    const unresolvedFields = unresolvedWarnings
        .filter((w) => !infraDroppedMismatch(w))
        .map((w) => {
            const fieldMatch = w.match(/field '([^']+)'/);
            return fieldMatch ? fieldMatch[1] : '[general-resolution-failure]';
        });

    const hasBlock =
        pendingConfirmations.length > 0 ||
        unresolvedFields.length > 0 ||
        infraErrors.length > 0 ||
        impersonationFailed;

    if (!hasBlock) return null;
    traceWriteGuard({
        phase: 'blocked',
        resource,
        operation,
        summary: {
            blockerTypes: [
                ...(pendingConfirmations.length > 0 ? ['ambiguous'] : []),
                ...(unresolvedFields.length > 0 ? ['unresolved'] : []),
                ...(infraErrors.length > 0 ? ['infra'] : []),
                ...(impersonationFailed ? ['impersonation'] : []),
            ],
            unresolvedFields,
            infraErrorsCount: infraErrors.length,
            ambiguousFieldsCount: pendingConfirmations.length,
            impersonationFailed,
        },
    });

    const parts: string[] = [];
    if (pendingConfirmations.length > 0) {
        const fields = pendingConfirmations.map((p) => `'${p.field}'`).join(', ');
        parts.push(`Ambiguous matches for field(s) ${fields} — multiple candidates found.`);
    }
    if (unresolvedFields.length > 0) {
        parts.push(`No match found for field(s): ${unresolvedFields.map((f) => `'${f}'`).join(', ')}.`);
    }
    if (infraErrors.length > 0) {
        parts.push(`Resolution infrastructure error(s) prevented field lookup.`);
    }
    if (impersonationFailed) {
        parts.push(`'impersonationResourceId' could not be resolved to a numeric resource ID.`);
    }

    const ctx: Record<string, unknown> = {};
    if (pendingConfirmations.length > 0) ctx.pendingConfirmations = pendingConfirmations;
    if (unresolvedFields.length > 0) ctx.unresolvedFields = unresolvedFields;
    if (infraErrors.length > 0) ctx.infraErrors = infraErrors;
    if (impersonationFailed) ctx.impersonationFailed = true;

    if (picklistMismatchWarnings.length > 0) {
        const invalidPicklistValues = picklistMismatchWarnings.map((w) => {
            const valueMatch = w.match(/picklist value '([^']+)'/);
            const fieldMatch = w.match(/field '([^']+)'/);
            return {
                field: fieldMatch ? fieldMatch[1] : '[unknown]',
                value: valueMatch ? valueMatch[1] : '[unknown]',
            };
        });
        const distinctFields = Array.from(
            new Set(invalidPicklistValues.map((v) => v.field).filter((f) => f !== '[unknown]')),
        );
        const nextAction =
            distinctFields.length > 0
                ? `Call autotask_${resource} with operation 'listPicklistValues' and fieldId='${distinctFields.join("' or '")}' to list valid values, then retry with a valid value.`
                : `Call autotask_${resource} with operation 'listPicklistValues' to list valid values, then retry with a valid value.`;
        const mustRetryAfter = ['listPicklistValues'];
        if (referenceStyleFailures.length > 0) mustRetryAfter.push('describeFields');
        ctx.invalidPicklistValues = invalidPicklistValues;
        return JSON.stringify(
            wrapError(
                resource,
                operation,
                ERROR_TYPES.INVALID_PICKLIST_VALUE,
                `Write blocked: ${parts.join(' ')} Resolve all field references before retrying.`,
                nextAction,
                ctx,
                mustRetryAfter,
            ),
        );
    }

    // v2.28.9 r7 (C1): when ONLY infrastructure failures block the write, nothing
    // was ever validated — the honest next step is "retry once the service
    // recovers", never a directive (listPicklistValues / describeFields) that
    // retries into the same outage.
    const pureInfraFailure =
        infraErrors.length > 0 &&
        unresolvedFields.length === 0 &&
        pendingConfirmations.length === 0 &&
        !impersonationFailed;
    const incompleteNextAction = pureInfraFailure
        ? `The Autotask API could not be reached or the field lookup was denied (infrastructure failure). Do not retry listPicklistValues or this write now — retry the same autotask_${resource} '${operation}' call once the service recovers.`
        : `Call autotask_${resource} with operation 'describeFields' to inspect field metadata, then retry with exact IDs or unambiguous labels.`;
    return JSON.stringify(
        wrapError(
            resource,
            operation,
            ERROR_TYPES.WRITE_RESOLUTION_INCOMPLETE,
            `Write blocked: ${parts.join(' ')} Resolve all field references before retrying.`,
            incompleteNextAction,
            ctx,
        ),
    );
}
