import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import type { IAutotaskField, IFieldValidationRules } from '../../types';
import { handleErrors } from '../../helpers/errorHandler';
import type { IDataObject } from 'n8n-workflow';
import { getConfiguredTimezone } from '../../helpers/date-time/utils';
import { DATE_FORMATS } from '../../constants/date.constants';
import moment from 'moment-timezone';

/**
 * Validates field values based on field type and constraints
 */
export class FieldValidator {
	private timezone = 'UTC'; // Default to UTC until initialized
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	constructor(
		private readonly entityType: string,
		private readonly context: IExecuteFunctions | ILoadOptionsFunctions,
		private readonly operation: 'create' | 'update' | 'delete' | 'get' | 'getMany' | 'count',
	) {
		// Initialize immediately
		this.initPromise = this.init();
	}

	/**
	 * Initialize the validator by setting the timezone from credentials
	 * @private
	 */
	private async init(): Promise<void> {
		try {
			this.timezone = await getConfiguredTimezone.call(this.context);
			console.debug(`[FieldValidator:${this.entityType}] Initialized with timezone: ${this.timezone}`);
		} catch (error) {
			console.warn(`[FieldValidator:${this.entityType}] Error getting configured timezone, using UTC:`, error);
			this.timezone = 'UTC';
		} finally {
			this.initialized = true;
		}
	}

	/**
	 * Ensure validator is initialized before proceeding
	 * @private
	 */
	private async ensureInitialized(): Promise<void> {
		if (!this.initialized && this.initPromise) {
			await this.initPromise;
		}
	}

	/**
	 * Validate a field value
	 */
	async validateField(
		field: IAutotaskField & { validation: IFieldValidationRules },
		value: unknown,
	): Promise<{ value: unknown; error?: string }> {
		// Ensure timezone is initialized
		await this.ensureInitialized();

		return await handleErrors(this.context as IExecuteFunctions, async () => {
			// Skip validation for read operations
			if (this.operation === 'get' || this.operation === 'getMany' || this.operation === 'count') {
				return { value };
			}

			// Allow empty values for optional fields
			if (!field.validation.isRequired && (value === undefined || value === null || value === '')) {
				return { value: null };
			}

			// Convert value to correct type
			const convertedValue = await this.convertValueType(field, value);
			if (convertedValue.error) {
				return convertedValue;
			}

			// Validate field constraints
			const constraintError = await this.validateConstraints(field, convertedValue.value);
			if (constraintError) {
				return { value: convertedValue.value, error: constraintError };
			}

			return { value: convertedValue.value };
		});
	}

	/**
	 * Convert value to correct type
	 */
	private async convertValueType(
		field: IAutotaskField & { validation: IFieldValidationRules },
		value: unknown,
	): Promise<{ value: unknown; error?: string }> {
		try {
			if (value === undefined || value === null || value === '') {
				if (field.dataType === 'integer') {
					return { value: null };
				}
				return { value: null };
			}

			switch (field.dataType) {
				case 'string': {
					return { value: String(value) };
				}

				case 'integer': {
					const intValue = Number.parseInt(value as string, 10);
					if (Number.isNaN(intValue)) {
						return { value, error: 'Invalid integer value' };
					}
					return { value: intValue };
				}

				case 'double': {
					const floatValue = Number.parseFloat(value as string);
					if (Number.isNaN(floatValue)) {
						return { value, error: 'Invalid decimal value' };
					}
					return { value: floatValue };
				}

				case 'boolean': {
					if (typeof value === 'string') {
						return { value: value.toLowerCase() === 'true' };
					}
					return { value: Boolean(value) };
				}

				case 'dateTime':
				case 'date': {
					try {
						// Return null for empty values
						if (value === null || value === '' || value === undefined) {
							return { value: null };
						}

						// Only validate the date format without converting
						// Conversion will happen later in convertDatesToUTC
						if (typeof value === 'string') {
							// Special case for n8n format
							if (value.includes('T') && value.includes(':')) {
								const valueToCheck = value.endsWith('Z') ? value.slice(0, -1) : value;
								const momentDate = moment(valueToCheck, 'YYYY-MM-DDTHH:mm:ss');
								if (!momentDate.isValid()) {
									return { value, error: `Invalid n8n date format: ${value}` };
								}
							} else {
								// For other formats, use moment's auto-detection
								const momentDate = moment(value);
								if (!momentDate.isValid()) {
									return { value, error: `Invalid date format: ${value}` };
								}
							}
						} else if (value instanceof Date) {
							if (Number.isNaN(value.getTime())) {
								return { value, error: 'Invalid Date object' };
							}
						}

						// If validation passes, return the original value
						// Actual conversion will happen in convertDatesToUTC
						return { value };
					} catch (error) {
						console.error(`Error validating date field ${field.name}:`, error);
						return { value, error: `Failed to validate date: ${error instanceof Error ? error.message : 'Unknown error'}` };
					}
				}

				default: {
					// Special case for fields with date/time naming patterns that might not be correctly typed
					const fieldLower = field.name.toLowerCase();
					if ((fieldLower.includes('date') || fieldLower.includes('time') || fieldLower.endsWith('at')) &&
						typeof value === 'string' && value.includes('T') && value.includes(':')) {

						console.debug(`[FieldValidator:${this.entityType}] Field ${field.name} detected as a date by name pattern`);

						try {
							// Handle as a dateTime field
							const momentDate = moment.tz(value as string, 'YYYY-MM-DDTHH:mm:ss', this.timezone).utc();

							if (momentDate.isValid()) {
								const formattedDate = momentDate.format(DATE_FORMATS.API_DATETIME);
								console.debug(`[FieldValidator:${this.entityType}] Name-pattern date conversion for ${field.name}: '${value}' to UTC: '${formattedDate}'`);
								return { value: formattedDate };
							}
						} catch (e) {
							console.debug(`[FieldValidator:${this.entityType}] Error in name-pattern date conversion: ${e}`);
						}
					}

					throw new Error(`Unknown data type for field ${field.name}: ${field.dataType} in entity ${this.entityType}`);
				}
			}
		} catch (error) {
			return { value, error: 'Failed to convert value type' };
		}
	}

	/**
	 * Validate field constraints
	 */
	private async validateConstraints(
		field: IAutotaskField & { validation: IFieldValidationRules },
		value: unknown,
	): Promise<string | undefined> {
		try {
			if (value === null) {
				if (field.validation.isRequired) {
					return 'Field is required';
				}
				return undefined;
			}

			if (field.validation.isReadOnly) {
				return 'Field is read-only';
			}

			if (typeof value === 'string' && field.validation.length) {
				if (value.length > field.validation.length) {
					return `Value exceeds maximum length of ${field.validation.length}`;
				}
			}

			if (typeof value === 'number') {
				if (field.validation.min !== undefined && value < field.validation.min) {
					return `Value must be greater than or equal to ${field.validation.min}`;
				}
				if (field.validation.max !== undefined && value > field.validation.max) {
					return `Value must be less than or equal to ${field.validation.max}`;
				}
			}

			if (field.validation.pattern && typeof value === 'string') {
				const regex = new RegExp(field.validation.pattern);
				if (!regex.test(value)) {
					return 'Value does not match required pattern';
				}
			}

			return undefined;
		} catch (error) {
			return 'Failed to validate field constraints';
		}
	}

	/**
	 * Validates multiple fields
	 */
	validateFields(fields: IAutotaskField[], data: IDataObject): boolean {
		try {
			for (const field of fields) {
				const value = data[field.name];
				const fieldWithValidation = {
					...field,
					validation: {
						isRequired: field.isRequired,
						isReadOnly: field.isReadOnly,
						isQueryable: field.isQueryable,
						length: field.length,
					},
				};

				if (!this.validateField(fieldWithValidation, value)) {
					return false;
				}
			}
			return true;
		} catch (error) {
			throw new Error(`Field validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
