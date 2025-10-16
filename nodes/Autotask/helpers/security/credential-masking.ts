/**
 * Security utilities for masking sensitive credential information in logs
 */

/**
 * Sensitive credential field names that should be masked
 */
const SENSITIVE_KEYS = ['Secret', 'APIIntegrationcode', 'Username', 'secret', 'apiIntegrationcode', 'username', 'password', 'token'];

/**
 * Masks a single credential value according to security requirements
 * @param key The credential key name
 * @param value The credential value to mask
 * @returns Masked credential value
 */
export function maskCredentialValue(key: string, value: string): string {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const lowerKey = key.toLowerCase();

  // Completely mask Secret and APIIntegrationcode
  if (lowerKey === 'secret' || lowerKey === 'apiintegrationcode') {
    return '********';
  }

  // For Username, show first 3 characters and mask the rest
  if (lowerKey === 'username') {
    if (value.length <= 3) {
      return value; // Don't mask if too short
    }
    return value.substring(0, 3) + '*****';
  }

  // For other sensitive fields like password/token
  if (SENSITIVE_KEYS.some(k => lowerKey.includes(k.toLowerCase()))) {
    return '********';
  }

  return value;
}

/**
 * Recursively masks sensitive credential fields in an object
 * @param obj The object to sanitize
 * @returns A new object with masked credentials
 */
export function maskCredentials(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitive types
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => maskCredentials(item));
  }

  // Handle objects
  const sanitized: any = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if this key is sensitive and the value is a string
    if (typeof value === 'string' && SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      sanitized[key] = maskCredentialValue(key, value);
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = maskCredentials(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitizes an error object for safe logging by masking credentials
 * This handles various error formats including Axios errors
 * @param error The error object to sanitize
 * @returns A sanitized copy of the error safe for logging
 */
export function sanitizeErrorForLogging(error: any): any {
  if (!error || typeof error !== 'object') {
    return error;
  }

  try {
    // Create a shallow copy to avoid mutating the original
    const sanitized: any = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };

    // Sanitize request config if present (Axios errors)
    if (error.config) {
      sanitized.config = {
        ...error.config,
        headers: error.config.headers ? maskCredentials(error.config.headers) : undefined,
      };
    }

    // Sanitize request if present
    if (error.request && typeof error.request === 'object') {
      // Only include safe request properties
      sanitized.request = {
        method: error.request.method,
        url: error.request.url,
        path: error.request.path,
        // Mask headers if present
        headers: error.request.headers ? maskCredentials(error.request.headers) : undefined,
      };
    }

    // Sanitize response if present
    if (error.response) {
      sanitized.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data, // Keep response data as-is (doesn't contain credentials)
        // Mask headers if present
        headers: error.response.headers ? maskCredentials(error.response.headers) : undefined,
        // Mask config headers if present
        config: error.response.config ? {
          ...error.response.config,
          headers: error.response.config.headers ? maskCredentials(error.response.config.headers) : undefined,
        } : undefined,
      };
    }

    // Include any other properties that don't contain credentials
    if (error.statusCode) {
      sanitized.statusCode = error.statusCode;
    }
    if (error.code) {
      sanitized.code = error.code;
    }

    return sanitized;
  } catch (sanitizationError) {
    // If sanitization fails, return a safe error object
    return {
      message: error.message || 'Error during sanitization',
      sanitizationError: 'Failed to sanitize error object',
    };
  }
}

