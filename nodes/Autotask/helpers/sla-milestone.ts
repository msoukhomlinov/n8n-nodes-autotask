// Shared SLA milestone helpers — used by both slaHealthCheck (execute.ts) and ticket.summary.

function parseDateValue(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

export function roundSlaHours(value: number): number {
    return Math.round(value * 100) / 100;
}

export function computeMilestoneStatus(
    dueDateTime: string | null,
    actualDateTime: string | null,
    elapsedHours: number | null,
    isMet: boolean | null,
    now: Date,
): { status: string; wallClockRemainingHours: number | null } {
    const dueDate = parseDateValue(dueDateTime);
    const actualDate = parseDateValue(actualDateTime);

    if (isMet === true) {
        return { status: 'Met', wallClockRemainingHours: null };
    }

    if (isMet === false) {
        return { status: 'Breached', wallClockRemainingHours: null };
    }

    if (dueDate && actualDate) {
        return {
            status: actualDate.getTime() <= dueDate.getTime() ? 'Met' : 'Breached',
            wallClockRemainingHours: null,
        };
    }

    if (!dueDate) {
        return { status: 'Pending', wallClockRemainingHours: null };
    }

    const remaining = roundSlaHours((dueDate.getTime() - now.getTime()) / 3600000);
    if (remaining < 0) {
        return { status: 'Breached', wallClockRemainingHours: remaining };
    }

    if (elapsedHours !== null && elapsedHours > 0) {
        const total = elapsedHours + remaining;
        if (total > 0 && remaining / total < 0.25) {
            return { status: 'At Risk', wallClockRemainingHours: remaining };
        }
        return { status: 'On Track', wallClockRemainingHours: remaining };
    }

    return {
        status: remaining <= 1 ? 'At Risk' : 'On Track',
        wallClockRemainingHours: remaining,
    };
}
