/**
 * Text Sanitization Utilities
 *
 * Handles defensive cleanup of corrupted text from docxmlater framework.
 *
 * PROBLEM CONTEXT:
 * ─────────────────
 * The docxmlater Hyperlink.getText() method may return text containing XML markup
 * when the underlying Run object contains corrupted data. This happens when:
 * - Hyperlink runs have malformed XML structures
 * - Text nodes contain embedded XML tags like <w:t xml:space="preserve">
 * - Document was previously corrupted or modified externally
 *
 * EXPECTED BEHAVIOR:
 * The Run() constructor auto-cleans by default (cleanXmlFromText: true)
 * But Hyperlink.getText() doesn't apply the same cleanup.
 *
 * SOLUTION:
 * Apply defensive XML tag removal to all hyperlink text extraction.
 * This prevents XML corruption from propagating through the system.
 *
 * EXAMPLE:
 * Input:  "Important Information<w:t xml:space=\"preserve\">1"
 * Output: "Important Information1"
 */

/**
 * Remove XML markup from text
 *
 * Removes any XML-like tags: <w:t>, <w:t xml:space="preserve">, etc.
 * Safe to call on any text - if no tags present, returns unchanged.
 *
 * @param text - The text that may contain XML markup
 * @returns The text with XML tags removed
 *
 * @example
 * ```typescript
 * sanitizeHyperlinkText("Hello<w:t>World</w:t>")
 * // Returns: "HelloWorld"
 *
 * sanitizeHyperlinkText("Clean text")
 * // Returns: "Clean text"
 *
 * sanitizeHyperlinkText("Text with<w:t xml:space=\"preserve\">space")
 * // Returns: "Text withspace"
 * ```
 */
export function sanitizeHyperlinkText(text: string): string {
  if (!text) return '';

  // Remove all XML tags: <...> patterns
  // This matches:
  // - Simple tags: <w:t>
  // - Tags with attributes: <w:t xml:space="preserve">
  // - Self-closing tags: <br/>
  // - Any other XML markup
  const cleaned = text.replace(/<[^>]+>/g, '');

  return cleaned;
}

/**
 * Sanitize display text with optional fallback
 *
 * If the text is empty after sanitization, optionally falls back to a default.
 * Useful for hyperlink display text that might be corrupted to empty strings.
 *
 * @param text - The text to sanitize
 * @param fallback - Optional fallback if result is empty
 * @returns The sanitized text, or fallback if empty
 *
 * @example
 * ```typescript
 * // With fallback
 * sanitizeHyperlinkTextWithFallback("<w:t>", "Click here")
 * // Returns: "Click here"
 *
 * // Without fallback
 * sanitizeHyperlinkTextWithFallback("Normal Text")
 * // Returns: "Normal Text"
 * ```
 */
export function sanitizeHyperlinkTextWithFallback(text: string, fallback?: string): string {
  const sanitized = sanitizeHyperlinkText(text);

  if (!sanitized && fallback) {
    return fallback;
  }

  return sanitized;
}

/**
 * Check if text appears to contain XML corruption
 *
 * Useful for diagnostic logging and determining if corruption occurred.
 *
 * @param text - The text to check
 * @returns true if the text contains XML-like tags
 *
 * @example
 * ```typescript
 * isTextCorrupted("Normal text")
 * // Returns: false
 *
 * isTextCorrupted("Text<w:t>with tags</w:t>")
 * // Returns: true
 * ```
 */
export function isTextCorrupted(text: string): boolean {
  if (!text) return false;
  return /<[^>]+>/.test(text);
}

/**
 * Sanitize array of hyperlink texts
 *
 * Applies sanitization to multiple texts efficiently.
 *
 * @param texts - Array of texts to sanitize
 * @returns Array of sanitized texts
 *
 * @example
 * ```typescript
 * sanitizeHyperlinkTexts([
 *   "Text<w:t>1</w:t>",
 *   "Normal text",
 *   "Another<tag>corrupted</tag>"
 * ])
 * // Returns: ["Text1", "Normal text", "Anothercorrupted"]
 * ```
 */
export function sanitizeHyperlinkTexts(texts: string[]): string[] {
  return texts.map(sanitizeHyperlinkText);
}
