/**
 * URL Helper Utilities
 *
 * Provides functions for sanitizing, validating, and fixing common URL encoding issues.
 * This is critical for Azure Logic Apps URLs which often come with encoded query parameters.
 */

/**
 * Sanitize a URL by decoding common encoding issues
 *
 * Fixes three common URL encoding problems:
 * 1. Unicode escapes: \u0026 → &
 * 2. HTML entities: &amp; → &
 * 3. URL encoding: %26 → &
 *
 * @param url - The URL to sanitize (may contain encoded characters)
 * @returns Sanitized URL with properly decoded query parameters
 *
 * @example
 * // Azure Logic App URL with Unicode escapes
 * const encoded = 'https://api.com?v=1\u0026sp=/triggers';
 * const clean = sanitizeUrl(encoded);
 * // Result: 'https://api.com?v=1&sp=/triggers'
 */
export function sanitizeUrl(url: string): string {
  if (!url) return url;

  let sanitized = url;

  // Step 1: Decode Unicode escapes (\u0026 → &)
  // Common when URLs are stored in JSON or JavaScript strings
  sanitized = sanitized.replace(/\\u0026/g, '&');

  // Step 2: Decode HTML entities (&amp; → &, &lt; → <, &gt; → >)
  // Common when URLs are copied from HTML documents
  sanitized = sanitized.replace(/&amp;/g, '&');
  sanitized = sanitized.replace(/&lt;/g, '<');
  sanitized = sanitized.replace(/&gt;/g, '>');
  sanitized = sanitized.replace(/&quot;/g, '"');

  // Step 3: Decode URL encoding (%26 → &, %3D → =, etc.)
  // Common when URLs are copied from browsers
  // Note: We only decode the query string part to preserve intentional encoding
  try {
    const urlObj = new URL(sanitized);
    const searchParams = new URLSearchParams(urlObj.search);

    // Rebuild query string from decoded parameters
    const params: string[] = [];
    searchParams.forEach((value, key) => {
      params.push(`${decodeURIComponent(key)}=${decodeURIComponent(value)}`);
    });

    if (params.length > 0) {
      sanitized = `${urlObj.origin}${urlObj.pathname}?${params.join('&')}${urlObj.hash}`;
    }
  } catch (e) {
    // If URL parsing fails, return the partially sanitized version
    // This handles cases where the URL is malformed
  }

  return sanitized;
}

/**
 * Validate that a URL is properly formatted for Azure Logic Apps
 *
 * Checks for common issues:
 * - Contains encoded characters that should be decoded
 * - Has required query parameters (api-version, sp, sv, sig)
 * - Is a valid HTTPS URL
 *
 * @param url - The URL to validate
 * @returns Object with validation result and any issues found
 */
export function validatePowerAutomateUrl(url: string): {
  valid: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!url) {
    issues.push('URL is empty');
    return { valid: false, issues, warnings };
  }

  // Check for encoded characters that should be decoded
  if (url.includes('\\u0026')) {
    warnings.push('URL contains Unicode escapes (\\u0026). These will be auto-decoded.');
  }
  if (url.includes('&amp;')) {
    warnings.push('URL contains HTML entities (&amp;). These will be auto-decoded.');
  }

  // Try to parse the URL
  try {
    const urlObj = new URL(sanitizeUrl(url));

    // Must be HTTPS for Azure Logic Apps
    if (urlObj.protocol !== 'https:') {
      issues.push('URL must use HTTPS protocol for Azure Logic Apps');
    }

    // Check for required Azure Logic Apps query parameters
    const searchParams = new URLSearchParams(urlObj.search);

    if (!searchParams.has('api-version')) {
      issues.push('Missing required parameter: api-version');
    }
    if (!searchParams.has('sp')) {
      warnings.push('Missing "sp" parameter (shared access policy). May be required depending on your Logic App configuration.');
    }
    if (!searchParams.has('sv')) {
      warnings.push('Missing "sv" parameter (signature version). May be required depending on your Logic App configuration.');
    }
    if (!searchParams.has('sig')) {
      warnings.push('Missing "sig" parameter (signature). May be required for authentication.');
    }

    // Check if URL looks like an Azure Logic Apps endpoint
    if (!urlObj.hostname.includes('logic.azure.com') && !urlObj.hostname.includes('azure-api.net')) {
      warnings.push('URL does not appear to be an Azure Logic Apps endpoint. Expected domain: *.logic.azure.com');
    }

  } catch (e) {
    issues.push(`Invalid URL format: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Test if a URL is reachable by making a HEAD request
 *
 * @param url - The URL to test
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Object with reachability status and any error message
 */
export async function testUrlReachability(
  url: string,
  timeoutMs: number = 10000
): Promise<{
  reachable: boolean;
  statusCode?: number;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sanitized = sanitizeUrl(url);

    // Make a HEAD request to avoid downloading large payloads
    const response = await fetch(sanitized, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      reachable: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        reachable: false,
        error: `Request timed out after ${timeoutMs}ms`,
      };
    }

    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract query parameters from a URL
 *
 * @param url - The URL to parse
 * @returns Map of parameter names to values
 */
export function extractQueryParams(url: string): Map<string, string> {
  const params = new Map<string, string>();

  try {
    const sanitized = sanitizeUrl(url);
    const urlObj = new URL(sanitized);
    const searchParams = new URLSearchParams(urlObj.search);

    searchParams.forEach((value, key) => {
      params.set(key, value);
    });
  } catch (e) {
    // Return empty map if URL is malformed
  }

  return params;
}

/**
 * Check if a URL has any encoding issues that need fixing
 *
 * @param url - The URL to check
 * @returns True if the URL has encoding issues, false otherwise
 */
export function hasEncodingIssues(url: string): boolean {
  if (!url) return false;

  return (
    url.includes('\\u0026') ||
    url.includes('&amp;') ||
    url.includes('&lt;') ||
    url.includes('&gt;') ||
    url.includes('&quot;')
  );
}

/**
 * SECURITY: Validate URL scheme for user-controlled hyperlink replacements
 *
 * Prevents XSS-like attacks by rejecting dangerous URL schemes that could:
 * - Execute JavaScript (javascript:)
 * - Embed data URIs (data:)
 * - Access local files (file:///)
 * - Use other non-HTTP protocols
 *
 * @param url - The URL to validate
 * @returns Object with validation result and error message if invalid
 *
 * @example
 * validateUrlScheme('https://example.com') // { valid: true, isHttp: true }
 * validateUrlScheme('javascript:alert(1)') // { valid: false, error: '...', isHttp: false }
 */
export function validateUrlScheme(url: string): {
  valid: boolean;
  isHttp: boolean;
  error?: string;
} {
  if (!url || url.trim() === '') {
    return { valid: true, isHttp: false }; // Allow empty (will be handled elsewhere)
  }

  try {
    // Attempt to parse as URL
    const parsed = new URL(url);

    // Whitelist only HTTP/HTTPS protocols
    const allowedSchemes = ['http:', 'https:'];
    const isAllowed = allowedSchemes.includes(parsed.protocol.toLowerCase());

    if (!isAllowed) {
      return {
        valid: false,
        isHttp: false,
        error: `Dangerous URL scheme detected: "${parsed.protocol}". Only http:// and https:// are allowed for security.`
      };
    }

    return { valid: true, isHttp: true };

  } catch (error) {
    // If URL parsing fails, it might be a relative URL or malformed
    // Check for obvious dangerous patterns even if URL parse fails
    const lowerUrl = url.toLowerCase().trim();

    if (lowerUrl.startsWith('javascript:')) {
      return {
        valid: false,
        isHttp: false,
        error: 'JavaScript URLs are not allowed for security reasons.'
      };
    }

    if (lowerUrl.startsWith('data:')) {
      return {
        valid: false,
        isHttp: false,
        error: 'Data URLs are not allowed for security reasons.'
      };
    }

    if (lowerUrl.startsWith('file:')) {
      return {
        valid: false,
        isHttp: false,
        error: 'File URLs are not allowed for security reasons.'
      };
    }

    // If it's not a parseable URL and doesn't match dangerous patterns,
    // it might be a content ID or relative path - allow it
    return { valid: true, isHttp: false };
  }
}
