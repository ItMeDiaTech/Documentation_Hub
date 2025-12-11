/**
 * URL Pattern Utilities for theSource Hyperlink Processing
 *
 * SINGLE SOURCE OF TRUTH for Content ID and Document ID extraction
 * Used across all hyperlink processing services
 *
 * This utility centralizes regex patterns that were previously duplicated across:
 * - HyperlinkService.ts
 * - WordDocumentProcessor.ts
 * - HyperlinkManager.ts
 * - DocXMLaterProcessor.ts
 * - types/hyperlink.ts
 */

/**
 * Regex Patterns for theSource URLs
 *
 * Content ID Format: TSRC-ABC-123456 or CMS-XYZ-789012
 * Document ID Format: docid=<uuid-or-alphanumeric>
 */
export const URL_PATTERNS = {
  /**
   * Matches theSource Content IDs
   * Examples: TSRC-ABC-123456, CMS-XYZ-789012
   * Pattern: (TSRC|CMS)-(alphanumeric)-(6 digits)
   *
   * Format Specification:
   * - Prefix: TSRC or CMS
   * - Separator: hyphen (-)
   * - Middle: alphanumeric characters (A-Z, a-z, 0-9)
   * - Separator: hyphen (-)
   * - Suffix: exactly 6 digits
   */
  CONTENT_ID: /(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})/i,

  /**
   * Matches theSource Document IDs
   * Examples: docid=abc-123-def, docid=abc123
   * Pattern: docid=(alphanumeric with dashes)
   *
   * Format Specification:
   * - Prefix: docid= (case-insensitive)
   * - Value: alphanumeric characters with optional hyphens
   * - Boundary: stops at non-alphanumeric/dash character or end of string
   */
  DOCUMENT_ID: /docid=([a-zA-Z0-9-]+)(?:[^a-zA-Z0-9-]|$)/i,

  /**
   * Matches theSource domain
   * Example: thesource.cvshealth.com
   */
  THE_SOURCE_DOMAIN: /thesource\.cvshealth\.com/i,
} as const;

/**
 * Extract Content ID from a URL
 *
 * @param url - URL to extract from
 * @returns Content ID (e.g., "TSRC-ABC-123456") or null if not found
 *
 * @example
 * extractContentId('https://thesource.com/doc?Content_ID=TSRC-ABC-123456')
 * // Returns: "TSRC-ABC-123456"
 *
 * extractContentId('https://google.com')
 * // Returns: null
 */
export function extractContentId(url: string): string | null {
  if (!url) return null;
  const match = url.match(URL_PATTERNS.CONTENT_ID);
  return match ? match[0] : null; // Return full match (TSRC-ABC-123456)
}

/**
 * Extract Content ID from any text string (file path, display text, etc.)
 *
 * This is used as a fallback when the URL is not available from getUrl(),
 * such as with file-type hyperlinks where the URL is stored in the
 * relationship target but getUrl() returns undefined.
 *
 * @param text - Text to search for Content_ID pattern
 * @returns Content ID (e.g., "TSRC-ABC-123456") or null if not found
 *
 * @example
 * extractContentIdFromText('C:\\Users\\user\\Downloads\\TSRC-PROD-015483')
 * // Returns: "TSRC-PROD-015483"
 *
 * extractContentIdFromText('Document: TSRC-ABC-123456 (Final)')
 * // Returns: "TSRC-ABC-123456"
 *
 * extractContentIdFromText('Reviewing SharePoint Errors (Seniors Only)')
 * // Returns: null
 */
export function extractContentIdFromText(text: string): string | null {
  if (!text) return null;
  const match = text.match(URL_PATTERNS.CONTENT_ID);
  return match ? match[0] : null;
}

/**
 * Extract Document ID from a URL
 *
 * @param url - URL to extract from
 * @returns Document ID (UUID/alphanumeric) or null if not found
 *
 * @example
 * extractDocumentId('https://thesource.com/#!/view?docid=abc-123-def')
 * // Returns: "abc-123-def"
 *
 * extractDocumentId('https://thesource.com/#!/view?docid=abc123#content')
 * // Returns: "abc123"
 *
 * extractDocumentId('https://google.com')
 * // Returns: null
 */
export function extractDocumentId(url: string): string | null {
  if (!url) return null;
  const match = url.match(URL_PATTERNS.DOCUMENT_ID);
  return match ? match[1] : null; // Return captured group (the ID itself)
}

/**
 * Extract both Lookup IDs (Content ID and Document ID) from a URL
 *
 * This is the primary method used by WordDocumentProcessor for API lookups.
 * It attempts to extract both types of IDs and returns whichever are found.
 *
 * @param url - URL to extract from
 * @returns Object with contentId and/or documentId, or null if neither found
 *
 * @example
 * extractLookupIds('https://thesource.com/doc?Content_ID=TSRC-ABC-123456&docid=abc123')
 * // Returns: { contentId: "TSRC-ABC-123456", documentId: "abc123" }
 *
 * extractLookupIds('https://thesource.com/doc?Content_ID=TSRC-ABC-123456')
 * // Returns: { contentId: "TSRC-ABC-123456" }
 *
 * extractLookupIds('https://google.com')
 * // Returns: null
 */
export function extractLookupIds(url: string): {
  contentId?: string;
  documentId?: string;
} | null {
  if (!url) return null;

  const lookupIds: { contentId?: string; documentId?: string } = {};

  const contentId = extractContentId(url);
  if (contentId) {
    lookupIds.contentId = contentId;
  }

  const documentId = extractDocumentId(url);
  if (documentId) {
    lookupIds.documentId = documentId;
  }

  return Object.keys(lookupIds).length > 0 ? lookupIds : null;
}

/**
 * Check if URL is a theSource URL
 *
 * @param url - URL to check
 * @returns true if theSource URL, false otherwise
 *
 * @example
 * isTheSourceUrl('https://thesource.cvshealth.com/nuxeo/...')
 * // Returns: true
 *
 * isTheSourceUrl('https://google.com')
 * // Returns: false
 */
export function isTheSourceUrl(url: string): boolean {
  if (!url) return false;
  return URL_PATTERNS.THE_SOURCE_DOMAIN.test(url);
}

/**
 * Check if URL has a Content ID
 *
 * @param url - URL to check
 * @returns true if Content ID found
 */
export function hasContentId(url: string): boolean {
  return extractContentId(url) !== null;
}

/**
 * Check if URL has a Document ID
 *
 * @param url - URL to check
 * @returns true if Document ID found
 */
export function hasDocumentId(url: string): boolean {
  return extractDocumentId(url) !== null;
}
