/** Represents the timezone state of a date value */
export enum TimezoneState {
    /** Date is in UTC timezone */
    UTC = 'UTC',
    /** Date is in local (user-configured) timezone */
    LOCAL = 'LOCAL',
}

/** Error thrown when an invalid timezone conversion is attempted */
export class InvalidTimezoneConversionError extends Error {
    constructor(message: string, public readonly details: Record<string, unknown>) {
        super(message);
        this.name = 'InvalidTimezoneConversionError';
    }
}

/** Error thrown when timezone configuration is invalid */
export class InvalidTimezoneConfigError extends Error {
    constructor(message: string, public readonly details: Record<string, unknown>) {
        super(message);
        this.name = 'InvalidTimezoneConfigError';
    }
}
