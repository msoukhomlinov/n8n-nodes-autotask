import type { IExecuteFunctions } from 'n8n-workflow';

/**
 * Normalizes a parameter name to a consistent format
 * Handles variations like 'parameterName', 'parameterID', 'parameterId'
 */
export function normalizeParameterName(name: string): string {
	// Special case for ID suffix
	if (/id$/i.test(name)) {
		const baseName = name.slice(0, -2);
		return `${baseName}id`;
	}

	// For camelCase parameters, preserve the case
	return name;
}

/**
 * Gets all possible variations of a parameter name
 * @param baseName The base parameter name
 * @returns Array of possible parameter name variations
 */
export function getParameterVariations(baseName: string): string[] {
	const variations: string[] = [baseName];

	// If the name ends with Id or ID, add other case variations
	if (/id$/i.test(baseName)) {
		const nameWithoutId = baseName.slice(0, -2);
		variations.push(
			`${nameWithoutId}ID`,
			`${nameWithoutId}Id`,
			`${nameWithoutId}id`
		);
	}

	return [...new Set(variations)]; // Remove duplicates
}

/**
 * Attempts to get a parameter value using case-insensitive matching
 * @param context The execution context
 * @param parameterName The parameter name to look for
 * @param itemIndex The current item index
 * @returns The parameter value if found
 * @throws Error if parameter not found after trying all variations
 */
export function getParameterInsensitive(
	context: IExecuteFunctions,
	parameterName: string,
	itemIndex: number
): unknown {
	const normalizedName = normalizeParameterName(parameterName);
	const variations = getParameterVariations(normalizedName);
	const triedVariations: string[] = [];

	// Try each variation
	for (const variation of variations) {
		triedVariations.push(variation);
		try {
			return context.getNodeParameter(variation, itemIndex);
		} catch {
			// Continue to next variation
		}
	}

	// If we get here, no variation worked
	throw new Error(
		`Could not find parameter. Tried variations: ${triedVariations.join(', ')}`
	);
}
