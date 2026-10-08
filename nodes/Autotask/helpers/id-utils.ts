// Shared utility: detects whether a value looks like a valid Autotask numeric ID.
// Most entity IDs are positive integers (>0). Company/Account is the sole exception:
// the root company record has id=0 and must be treated as a valid ID, not a label.
// Uses parseInt round-trip to reject zero-padded strings like "00123".
export function isLikelyId(v: unknown): boolean {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0;
    if (typeof v === 'string' && /^\d+$/.test(v)) {
        const n = parseInt(v, 10);
        return n >= 0 && String(n) === v;
    }
    return false;
}

/**
 * Normalises an identifier that will be placed in a request path. Accepts a
 * non-negative safe integer or a string of digits (surrounding whitespace is
 * ignored) and returns it as a string; anything else throws.
 */
export function toPathId(value: unknown, label = 'id'): string {
    const text = typeof value === 'number'
        ? (Number.isSafeInteger(value) && value >= 0 ? String(value) : '')
        : typeof value === 'string' ? value.trim() : '';
    if (!/^\d+$/.test(text)) {
        throw new Error(`Invalid ${label}: expected a non-negative whole number.`);
    }
    return text;
}
