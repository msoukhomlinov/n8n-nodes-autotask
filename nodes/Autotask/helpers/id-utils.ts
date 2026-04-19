// Shared utility: detects whether a value looks like a valid Autotask numeric ID.
// Autotask IDs are positive integers (>0). Uses parseInt round-trip to reject
// zero-padded strings like "00123".
export function isLikelyId(v: unknown): boolean {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0;
    if (typeof v === 'string' && /^\d+$/.test(v)) {
        const n = parseInt(v, 10);
        return n > 0 && String(n) === v;
    }
    return false;
}
