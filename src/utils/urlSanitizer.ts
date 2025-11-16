/**
 * URL Sanitization Utility
 *
 * Protects against XSS attacks via malicious URLs in href attributes.
 * Blocks dangerous protocols like javascript:, data:, vbscript:, file:
 *
 * Security Context:
 * - Prevents DOM-based XSS vulnerabilities
 * - Critical for Electron apps with IPC access
 * - Blocks protocol smuggling attacks
 *
 * @module urlSanitizer
 */

import logger from './logger';

/**
 * List of allowed URL protocols that are safe for href attributes
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'ftp:', 'ftps:'] as const;

/**
 * List of dangerous protocols that should be blocked
 * These can execute code or access local resources
 */
const DANGEROUS_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'about:',
  'blob:',
] as const;

/**
 * Sanitizes a URL to prevent XSS attacks via href attributes.
 *
 * Validates the URL protocol and structure to ensure it's safe for use
 * in HTML href attributes. Blocks dangerous protocols that could execute
 * arbitrary code or access local resources.
 *
 * @param url - The URL to sanitize (can be string, null, or undefined)
 * @returns A safe URL string, or '#' if the URL is invalid/dangerous
 *
 * @example
 * ```typescript
 * sanitizeUrl('https://example.com')           // ✅ 'https://example.com'
 * sanitizeUrl('javascript:alert("XSS")')       // ❌ '#'
 * sanitizeUrl('data:text/html,<script>')       // ❌ '#'
 * sanitizeUrl('mailto:user@example.com')       // ✅ 'mailto:user@example.com'
 * sanitizeUrl(null)                            // ❌ '#'
 * sanitizeUrl('')                              // ❌ '#'
 * ```
 */
export function sanitizeUrl(url: string | null | undefined): string {
  // Handle null, undefined, or empty strings
  if (!url || typeof url !== 'string') {
    return '#';
  }

  // Trim whitespace
  const trimmedUrl = url.trim();

  // Check for empty string after trimming
  if (trimmedUrl === '' || trimmedUrl === '#') {
    return '#';
  }

  // Handle relative URLs (consider safe if they don't start with dangerous patterns)
  if (trimmedUrl.startsWith('/') || trimmedUrl.startsWith('./') || trimmedUrl.startsWith('../')) {
    // Relative URLs are generally safe in web contexts
    // But in Electron, we want to be cautious
    return '#';
  }

  // Check if URL starts with a hash (anchor link - safe)
  if (trimmedUrl.startsWith('#')) {
    return trimmedUrl;
  }

  try {
    // Parse the URL to extract protocol
    // For URLs without protocol, URL constructor will throw
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      // If URL parsing fails, it might be a relative URL or malformed
      // Check if it looks like it has a protocol
      if (trimmedUrl.includes(':')) {
        // Has a colon, might be a protocol - check if dangerous
        const colonIndex = trimmedUrl.indexOf(':');
        const possibleProtocol = trimmedUrl.substring(0, colonIndex + 1).toLowerCase();

        // Check against dangerous protocols
        if (DANGEROUS_PROTOCOLS.includes(possibleProtocol as any)) {
          return '#';
        }
      }

      // If no protocol or unknown format, return safe fallback
      return '#';
    }

    // Convert protocol to lowercase for case-insensitive comparison
    const protocol = parsedUrl.protocol.toLowerCase();

    // Check against dangerous protocols
    if (DANGEROUS_PROTOCOLS.includes(protocol as any)) {
      return '#';
    }

    // Check if protocol is in allowed list
    if (ALLOWED_PROTOCOLS.includes(protocol as any)) {
      return trimmedUrl; // Return original URL (preserves casing)
    }

    // Unknown protocol - reject for safety
    return '#';
  } catch (error) {
    // If any error occurs during parsing, return safe fallback
    logger.warn('[URL Sanitizer] Failed to parse URL:', url, error);
    return '#';
  }
}

/**
 * Checks if a URL is safe without modifying it.
 *
 * @param url - The URL to check
 * @returns true if the URL is safe, false otherwise
 *
 * @example
 * ```typescript
 * isSafeUrl('https://example.com')           // true
 * isSafeUrl('javascript:alert("XSS")')       // false
 * ```
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  return sanitizeUrl(url) !== '#';
}

/**
 * Sanitizes an array of URLs.
 *
 * @param urls - Array of URLs to sanitize
 * @returns Array of sanitized URLs
 */
export function sanitizeUrls(urls: (string | null | undefined)[]): string[] {
  return urls.map(sanitizeUrl);
}
