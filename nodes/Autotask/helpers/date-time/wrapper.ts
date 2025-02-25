import moment from 'moment-timezone';
import { TimezoneState } from './errors';

/**
 * Wrapper for Date objects that tracks timezone state to prevent accidental double conversions
 * and ensures consistent date/time formatting for the Autotask API
 */
export class DateTimeWrapper {
    private readonly momentValue: moment.Moment;

    constructor(
        value: string | Date | moment.Moment,
        private readonly state: TimezoneState,
        private readonly source: string,
    ) {
        // Convert input to moment object
        this.momentValue = moment.isMoment(value)
            ? value.clone() // Clone to prevent mutations
            : moment(value);

        // Ensure the moment object is valid
        if (!this.momentValue.isValid()) {
            throw new Error(`Invalid date value from ${source}: ${value}`);
        }
    }

    /**
     * Creates a DateTimeWrapper from a UTC date/time
     */
    static fromUTC(value: string | Date | moment.Moment, source: string): DateTimeWrapper {
        const wrapper = new DateTimeWrapper(value, TimezoneState.UTC, source);
        wrapper.momentValue.utc(); // Ensure UTC mode
        return wrapper;
    }

    /**
     * Creates a DateTimeWrapper from a local timezone date/time
     */
    static fromLocal(value: string | Date | moment.Moment, source: string): DateTimeWrapper {
        return new DateTimeWrapper(value, TimezoneState.LOCAL, source);
    }

    /**
     * Gets the current timezone state
     */
    getState(): TimezoneState {
        return this.state;
    }

    /**
     * Gets the underlying date value
     * WARNING: This should only be used at system boundaries where the timezone state is known
     */
    getValue(): Date {
        return this.momentValue.toDate();
    }

    /**
     * Converts a local date to UTC
     */
    toUTC(timezone: string): DateTimeWrapper {
        if (this.state === TimezoneState.UTC) {
            return this;
        }

        const utcValue = this.momentValue.clone().tz(timezone).utc();
        return new DateTimeWrapper(utcValue, TimezoneState.UTC, this.source);
    }

    /**
     * Converts a UTC date to local timezone
     */
    fromUTC(timezone: string): DateTimeWrapper {
        if (this.state === TimezoneState.LOCAL) {
            return this;
        }

        const localValue = this.momentValue.clone().tz(timezone);
        return new DateTimeWrapper(localValue, TimezoneState.LOCAL, this.source);
    }

    /**
     * Formats the date according to the specified format
     * Uses Autotask API format by default:
     * - DateTime fields: YYYY-MM-DDTHH:mm:ss.SSS
     * - Date fields: YYYY-MM-DD
     */
    format(format?: string, timezone?: string): string {
        const value = timezone
            ? this.momentValue.clone().tz(timezone)
            : this.momentValue;

        const formatString = format ?? (
            this.momentValue.milliseconds() === 0
                ? 'YYYY-MM-DD' // Date only
                : 'YYYY-MM-DDTHH:mm:ss.SSS' // DateTime with milliseconds
        );

        return value.format(formatString);
    }

    /**
     * Returns true if this date represents the same moment as another date
     */
    isSame(other: DateTimeWrapper): boolean {
        return this.momentValue.isSame(other.momentValue);
    }

    /**
     * Returns true if this date is valid
     */
    isValid(): boolean {
        return this.momentValue.isValid();
    }

    /**
     * Returns the timezone state and source for debugging
     */
    toString(): string {
        return `DateTimeWrapper(${this.state}, ${this.source})`;
    }
}
