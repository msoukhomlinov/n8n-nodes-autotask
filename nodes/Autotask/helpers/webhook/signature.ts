import { createHmac, timingSafeEqual } from 'node:crypto';
import { AutotaskErrorType } from '../errorHandler';

/**
 * Standardized error logging utility for webhook operations
 * @param operation The name of the operation being performed
 * @param errorType The type of error that occurred
 * @param message Human-readable error message
 * @param error Optional error object or additional context
 */
function logError(
	operation: string,
	errorType: AutotaskErrorType,
	message: string,
	error?: unknown,
): void {
	const errorDetails = error instanceof Error ? `: ${error.message}` : '';
	const contextInfo = typeof error === 'object' && error !== null ? JSON.stringify(error) : '';
	console.error(
		`[${errorType}] Operation: ${operation}${errorDetails ? `, Details${errorDetails}` : ''}${contextInfo ? `, Context: ${contextInfo}` : ''}, ${message}`,
	);
}

/**
 * Processes a JSON string character by character, escaping specific characters inside string values
 * to match Autotask's escaping format exactly. Operates directly on the raw JSON string.
 *
 * This custom processor is necessary because:
 * 1. JSON.parse() removes Unicode escape sequences by converting them to actual characters
 * 2. JSON.stringify() doesn't escape characters like & and + by default
 * 3. Autotask uses a custom escaping scheme for webhook signatures
 * 4. Non-ASCII characters (like accented letters) need to be escaped as Unicode sequences
 */
function customEscapeJsonStrings(jsonString: string): string {
	// Characters to escape with their Unicode escape sequences
	const escapeMap: Record<string, string> = {
		'&': '\\u0026',
		'<': '\\u003C',
		'>': '\\u003E',
		"'": '\\u0027',
		'"': '\\u0022',
		'`': '\\u0060',
		'+': '\\u002B',
	};

	let result = '';
	let isInsideString = false;
	let isEscaped = false;

	// Process the JSON string character by character
	for (let i = 0; i < jsonString.length; i++) {
		const char = jsonString[i];

		// Special handling for escaped double quotes within strings
		// This converts \" in the original JSON to \u0022 in the output
		if (char === '"' && isEscaped && isInsideString) {
			// Remove the last backslash character and replace with Unicode escape sequence
			result = result.slice(0, -1) + escapeMap['"'];
			isEscaped = false;
			continue;
		}

		// Handle escape sequences
		if (char === '\\' && !isEscaped) {
			isEscaped = true;
			result += char;
			continue;
		}

		// Handle string boundaries
		if (char === '"' && !isEscaped) {
			isInsideString = !isInsideString;
			result += char;
		}
		// Apply character escaping only when inside string values
		else if (isInsideString && !isEscaped) {
			if (escapeMap[char]) {
				// Use predefined escape sequences for specific characters
				result += escapeMap[char];
			} else if (char.charCodeAt(0) > 127) {
				// Escape all non-ASCII characters (> 127) to Unicode escape sequences
				// Format: \uXXXX where XXXX is the hexadecimal code point (zero-padded to 4 digits)
				const codePoint = char.charCodeAt(0);
				const hexCode = codePoint.toString(16).padStart(4, '0').toUpperCase();
				result += `\\u${hexCode}`;
			} else {
				// Keep standard ASCII characters unchanged
				result += char;
			}
		}
		// Keep all other characters unchanged
		else {
			result += char;
		}

		// Reset escape flag after processing a character
		isEscaped = false;
	}

	return result;
}

/**
 * Verify a webhook signature using HMAC-SHA1
 * Following Autotask documentation requirements
 * See: https://ww1.autotask.net/help/developerhelp/Content/APIs/Webhooks/SecretKeyPayloadVerification.htm
 *
 * The Autotask documentation specifies:
 * 1. The secret key and request body are used to generate an HMAC-SHA1
 * 2. The signature is passed in the X-Hook-Signature header
 * 3. The format is `sha1=[base64-encoded HMAC]`, e.g., `sha1=UaDXFl2DRDu9dnINVkFle7y5uAE=`
 *
 * IMPORTANT: This function must use the raw HTTP body bytes that Autotask originally
 * signed, not a re-stringified version of a parsed object.
 */
export function verifyWebhookSignature(
	rawPayload: string,
	signature: string,
	secretKey: string,
): boolean {
	if (!rawPayload || !signature || !secretKey) {
		logError(
			'verifyWebhookSignature',
			AutotaskErrorType.Validation,
			'Missing required parameters for signature verification',
			{
				hasPayload: !!rawPayload,
				hasSignature: !!signature,
				hasSecretKey: !!secretKey,
			},
		);
		return false;
	}

	try {
		// Remove the "sha1=" prefix if present
		const normalizedSignature = signature.replace(/^sha1=/, '');

		// Process the raw JSON string with our custom escaper
		// This directly produces the format Autotask expects without parse/stringify cycles
		const escapedPayload = customEscapeJsonStrings(rawPayload);

		// Method 1: Standard string approach with escaped payload
		const hmac = createHmac('sha1', secretKey);
		hmac.update(escapedPayload, 'utf8');
		const generatedSignature = hmac.digest('base64');

		if (generatedSignature.length === normalizedSignature.length &&
			timingSafeEqual(Buffer.from(generatedSignature), Buffer.from(normalizedSignature))) {
			console.log('✓ Webhook signature verified successfully');
			return true;
		}

		// Method 2: Try with Buffer encoding for the secret key and escaped payload
		const hmacAlt = createHmac('sha1', Buffer.from(secretKey, 'utf8'));
		hmacAlt.update(escapedPayload, 'utf8');
		const altSignature = hmacAlt.digest('base64');

		if (altSignature.length === normalizedSignature.length &&
			timingSafeEqual(Buffer.from(altSignature), Buffer.from(normalizedSignature))) {
			console.log('✓ Webhook signature verified using Buffer-encoded secret key');
			return true;
		}

		// Method 3: Try original payload as fallback (for backward compatibility)
		const hmacFallback = createHmac('sha1', secretKey);
		hmacFallback.update(rawPayload, 'utf8');
		const fallbackSignature = hmacFallback.digest('base64');

		if (fallbackSignature.length === normalizedSignature.length &&
			timingSafeEqual(Buffer.from(fallbackSignature), Buffer.from(normalizedSignature))) {
			console.log('✓ Webhook signature verified using fallback unescaped payload');
			return true;
		}

		logError(
			'verifyWebhookSignature',
			AutotaskErrorType.Validation,
			'Webhook signature verification failed',
			{
				signatureLength: signature.length,
				payloadLength: rawPayload.length,
			},
		);
		return false;
	} catch (error) {
		logError(
			'verifyWebhookSignature',
			AutotaskErrorType.Unknown,
			'Error verifying webhook signature',
			error,
		);
		return false;
	}
}

/**
 * Generate an HMAC-SHA1 signature for a webhook payload
 * Uses the same format as Autotask to verify the signature (Base64)
 * Following Autotask documentation: https://ww1.autotask.net/help/developerhelp/Content/APIs/Webhooks/SecretKeyPayloadVerification.htm
 */
export function generateWebhookSignature(payload: string | unknown, secretKey: string): string {
	if (!payload || !secretKey) {
		logError(
			'generateWebhookSignature',
			AutotaskErrorType.Validation,
			'Missing required parameters for signature generation',
			{
				hasPayload: !!payload,
				hasSecretKey: !!secretKey,
			},
		);
		throw new Error('Missing required parameters for signature generation');
	}

	try {
		let payloadString: string;

		// Handle both string and object payloads
		if (typeof payload === 'string') {
			payloadString = payload;
		} else {
			payloadString = JSON.stringify(payload);
		}

		// Apply the same custom escaping as used in verification
		const escapedPayload = customEscapeJsonStrings(payloadString);

		// Standard implementation as per Autotask documentation
		const hmac = createHmac('sha1', secretKey);
		hmac.update(escapedPayload, 'utf8');
		return hmac.digest('base64');
	} catch (error) {
		logError(
			'generateWebhookSignature',
			AutotaskErrorType.Unknown,
			'Error generating webhook signature',
			error,
		);
		throw new Error(
			`Error generating webhook signature: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}
