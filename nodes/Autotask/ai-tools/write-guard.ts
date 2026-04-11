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
                        const fieldMatch = w.match(/for (?:field )?'([^']+)'/);
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
    const unresolvedFields = warnings
        .filter(
            (w) =>
                isResolutionFailureWarning(w) &&
                !w.startsWith('[INFRASTRUCTURE]') &&
                !w.includes('impersonation'),
        )
        .map((w) => {
            const fieldMatch = w.match(/for (?:field )?'([^']+)'/);
            return fieldMatch ? fieldMatch[1] : '[general-resolution-failure]';
        });
    const infraErrors = warnings.filter((w) => w.startsWith('[INFRASTRUCTURE]'));

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

    return JSON.stringify(
        wrapError(
            resource,
            operation,
            ERROR_TYPES.WRITE_RESOLUTION_INCOMPLETE,
            `Write blocked: ${parts.join(' ')} Resolve all field references before retrying.`,
            `Call autotask_${resource} with operation 'describeFields' to inspect field metadata, then retry with exact IDs or unambiguous labels.`,
            ctx,
        ),
    );
}
