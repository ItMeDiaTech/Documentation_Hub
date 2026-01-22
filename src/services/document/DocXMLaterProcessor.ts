import {
  Document,
  isHyperlink,
  isRevision,
  isHyperlinkContent,
} from 'docxmlater';
import type { Hyperlink, Paragraph, Revision } from 'docxmlater';
import { ProcessorResult } from './types/docx-processing';
import { logger } from '@/utils/logger';

// Create namespaced logger for document processing operations
const log = logger.namespace('DocXMLater');

/**
 * Configuration options for the DocXMLaterProcessor
 *
 * @interface DocXMLaterOptions
 * @property {boolean} [preserveFormatting=true] - Preserve existing formatting when applying styles
 * @property {boolean} [validateOutput=false] - Validate document structure before saving
 */
export interface DocXMLaterOptions {
  preserveFormatting?: boolean;
  validateOutput?: boolean;
}

/**
 * Main document processor class using the docxmlater library
 *
 * Provides a high-level API for DOCX document manipulation with comprehensive
 * error handling, type safety, and performance optimizations.
 *
 * @class DocXMLaterProcessor
 * @example
 * ```typescript
 * // Create processor with options
 * const processor = new DocXMLaterProcessor({
 *   preserveFormatting: true,
 *   validateOutput: false
 * });
 *
 * // Load and modify document
 * const result = await processor.loadFromFile('input.docx');
 * if (result.success) {
 *   // Work with document
 *   await processor.saveToFile(result.data, 'output.docx');
 * }
 * ```
 */
export class DocXMLaterProcessor {
  private defaultOptions: DocXMLaterOptions = {
    preserveFormatting: true,
    validateOutput: false,
  };

  /**
   * Creates a new DocXMLaterProcessor instance
   *
   * @param {DocXMLaterOptions} [options={}] - Configuration options for the processor
   * @param {boolean} [options.preserveFormatting=true] - Preserve existing formatting when applying styles
   * @param {boolean} [options.validateOutput=false] - Validate document structure before saving
   *
   * @example
   * ```typescript
   * // Default options
   * const processor = new DocXMLaterProcessor();
   *
   * // Custom options
   * const strictProcessor = new DocXMLaterProcessor({
   *   preserveFormatting: false,
   *   validateOutput: true
   * });
   * ```
   */
  constructor(options: DocXMLaterOptions = {}) {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  // ========== Document I/O Operations ==========

  /**
   * Load a DOCX document from a file path
   *
   * Uses the docxmlater framework defaults to ensure no corruption during loading.
   * Supports both absolute and relative file paths.
   *
   * **IMPORTANT: Memory Management**
   *
   * Always call `dispose()` on the returned Document when finished to free resources
   * and prevent memory leaks, especially in long-running applications or when processing
   * multiple documents.
   *
   * @async
   * @param {string} filePath - Absolute or relative path to the DOCX file
   * @returns {Promise<ProcessorResult<Document>>} Result containing the loaded Document or error
   *
   * @group Document I/O
   *
   * @example
   * ```typescript
   * const processor = new DocXMLaterProcessor();
   *
   * // Load document
   * const result = await processor.loadFromFile('./documents/report.docx');
   *
   * if (result.success) {
   *   console.log('Document loaded successfully');
   *   const doc = result.data;
   *   // Work with document...
   *   doc.dispose(); // Clean up when done
   * } else {
   *   console.error('Failed to load:', result.error);
   * }
   * ```
   *
   * @see {@link Document} for document manipulation methods
   * @see {@link ProcessorResult} for result handling
   */
  async loadFromFile(filePath: string): Promise<ProcessorResult<Document>> {
    log.debug('Loading document from file', { filePath });
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.load(filePath, { strictParsing: false });
      log.info('Document loaded successfully', { filePath });
      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
      log.error('Failed to load document', { filePath, error: error.message });
      return {
        success: false,
        error: `Failed to load document: ${error.message}`,
      };
    }
  }

  /**
   * Load a DOCX document from a Buffer object
   *
   * Useful for processing documents from memory, HTTP responses, or other sources
   * that provide data as Buffer objects. Uses docxmlater framework defaults to
   * ensure no corruption during loading.
   *
   * **IMPORTANT: Memory Management**
   *
   * Always call `dispose()` on the returned Document when finished to free resources
   * and prevent memory leaks, especially in long-running applications or when processing
   * multiple documents.
   *
   * @async
   * @param {Buffer} buffer - Buffer containing the DOCX file data
   * @returns {Promise<ProcessorResult<Document>>} Result containing the loaded Document or error
   *
   * @group Document I/O
   *
   * @example
   * ```typescript
   * const processor = new DocXMLaterProcessor();
   *
   * // Load from HTTP response
   * const response = await fetch('https://example.com/document.docx');
   * const arrayBuffer = await response.arrayBuffer();
   * const buffer = Buffer.from(arrayBuffer);
   *
   * const result = await processor.loadFromBuffer(buffer);
   * if (result.success) {
   *   const doc = result.data;
   *   // Work with document...
   *   doc.dispose(); // Clean up when done
   * }
   * ```
   *
   * @see {@link loadFromFile} for loading from file paths
   * @see {@link Document} for document manipulation methods
   */
  async loadFromBuffer(buffer: Buffer): Promise<ProcessorResult<Document>> {
    log.debug('Loading document from buffer', { bufferSize: buffer.length });
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.loadFromBuffer(buffer);
      log.info('Document loaded from buffer successfully', { bufferSize: buffer.length });
      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
      log.error('Failed to load document from buffer', { bufferSize: buffer.length, error: error.message });
      return {
        success: false,
        error: `Failed to load document from buffer: ${error.message}`,
      };
    }
  }

  /**
   * Load a document with revision handling based on auto-accept setting.
   *
   * This method simplifies the common pattern of loading documents for processing
   * where you need to handle tracked changes differently based on user preferences.
   *
   * **When acceptRevisions is TRUE:**
   * - Document is loaded with revisions preserved for inspection
   * - Revisions are then accepted using in-memory transformation
   * - Document is clean and ready for modifications
   * - Track changes is enabled for the specified author
   *
   * **When acceptRevisions is FALSE:**
   * - Document is loaded with revisions preserved
   * - All pre-existing tracked changes remain in the document
   * - Track changes is enabled for the specified author
   * - Both pre-existing AND new changes will be visible in Word
   *
   * @async
   * @param filePath - Path to the DOCX file
   * @param options - Revision handling options
   * @param options.acceptRevisions - Whether to accept pre-existing revisions (default: false)
   * @param options.author - Author name for tracked changes (default: 'Doc Hub')
   * @param options.trackFormatting - Whether to track formatting changes (default: true)
   * @returns ProcessorResult containing the loaded Document ready for processing
   *
   * @example
   * ```typescript
   * // Auto-Accept ON: Clean document, track DocHub changes
   * const result = await processor.loadWithRevisionHandling('input.docx', {
   *   acceptRevisions: true,
   *   author: 'Doc Hub'
   * });
   *
   * // Auto-Accept OFF: Preserve all revisions
   * const result = await processor.loadWithRevisionHandling('input.docx', {
   *   acceptRevisions: false,
   *   author: 'Doc Hub'
   * });
   * ```
   */
  async loadWithRevisionHandling(
    filePath: string,
    options: {
      acceptRevisions?: boolean;
      author?: string;
      trackFormatting?: boolean;
    } = {}
  ): Promise<ProcessorResult<Document>> {
    const { acceptRevisions = false, author = 'Doc Hub', trackFormatting = true } = options;

    log.debug('Loading document with revision handling', {
      filePath,
      acceptRevisions,
      author,
    });

    try {
      // Load document with appropriate revision handling
      const doc = await Document.load(filePath, {
        strictParsing: false,
        acceptRevisions: acceptRevisions, // NEW: Uses in-memory acceptance if true
        revisionHandling: acceptRevisions ? undefined : 'preserve', // Preserve if not accepting
      });

      // Enable track changes for subsequent modifications
      doc.enableTrackChanges({
        author,
        trackFormatting,
      });

      log.info('Document loaded with revision handling', {
        filePath,
        acceptRevisions,
        author,
      });

      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
      log.error('Failed to load document with revision handling', {
        filePath,
        error: error.message,
      });
      return {
        success: false,
        error: `Failed to load document: ${error.message}`,
      };
    }
  }

  async saveToFile(doc: Document, filePath: string): Promise<ProcessorResult<void>> {
    log.debug('Saving document to file', { filePath });
    try {
      await doc.save(filePath);
      log.info('Document saved successfully', { filePath });
      return {
        success: true,
      };
    } catch (error: any) {
      log.error('Failed to save document', { filePath, error: error.message });
      return {
        success: false,
        error: `Failed to save document: ${error.message}`,
      };
    }
  }

  /**
   * Save a Document to a file path with validation
   *
   * Performs atomic save operations with pre-save validation to prevent corruption and
   * oversized files. Estimates document size and blocks saves exceeding thresholds.
   * If the file already exists, it will be overwritten. The directory path must exist.
   *
   * @async
   * @param {Document} doc - Document instance to save
   * @param {string} filePath - Absolute or relative path where the DOCX file will be saved
   * @param {Object} [options] - Validation options
   * @param {number} [options.maxSizeMB=50] - Maximum allowed file size in MB (default: 50MB)
   * @param {boolean} [options.warnOnLarge=true] - Log warnings for files >10MB (default: true)
   * @returns {Promise<ProcessorResult<{sizeMB: number, warnings?: string[]}>>} Result with save confirmation and validation data
   *
   * @group Document I/O
   *
   * @example
   * ```typescript
   * const processor = new DocXMLaterProcessor();
   *
   * // Load and modify document
   * const loadResult = await processor.loadFromFile('input.docx');
   * if (loadResult.success) {
   *   const doc = loadResult.data;
   *
   *   // Make modifications...
   *   doc.replaceText('old', 'new');
   *
   *   // Save with validation
   *   const saveResult = await processor.saveToFileWithValidation(doc, 'output.docx');
   *   if (saveResult.success) {
   *     console.log(`Document saved (${saveResult.data.sizeMB.toFixed(2)}MB)`);
   *     if (saveResult.data.warnings?.length) {
   *       console.warn('Warnings:', saveResult.data.warnings);
   *     }
   *   } else {
   *     console.error('Save failed:', saveResult.error);
   *   }
   *
   *   doc.dispose();
   * }
   * ```
   */
  async saveToFileWithValidation(
    doc: Document,
    filePath: string,
    options?: {
      maxSizeMB?: number;
      warnOnLarge?: boolean;
    }
  ): Promise<
    ProcessorResult<{
      sizeMB: number;
      warnings?: string[];
    }>
  > {
    try {
      const maxSizeMB = options?.maxSizeMB || 50;
      const warnOnLarge = options?.warnOnLarge !== false;

      // First validate size
      const sizeResult = await this.estimateSize(doc);
      if (!sizeResult.success || !sizeResult.data) {
        return {
          success: false,
          error: `Size validation failed: ${sizeResult.error || 'No size data returned'}`,
        };
      }

      const sizeData = sizeResult.data;
      const sizeMB = sizeData.totalEstimatedMB;
      const warnings: string[] = [];

      // Check size limits
      if (sizeMB > maxSizeMB) {
        return {
          success: false,
          error: `Document size (${sizeMB.toFixed(2)}MB) exceeds maximum allowed size (${maxSizeMB}MB)`,
        };
      }

      // Log warnings for large files
      if (warnOnLarge && sizeMB > 10) {
        warnings.push(`Large document size: ${sizeMB.toFixed(2)}MB (recommended <10MB)`);
      }

      if (sizeData.warning) {
        warnings.push(sizeData.warning);
      }

      // Perform the save
      const saveResult = await this.saveToFile(doc, filePath);
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error || 'Save operation failed',
        };
      }

      return {
        success: true,
        data: {
          sizeMB,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Validation save failed: ${error.message}`,
      };
    }
  }

  // ========== Document Statistics ==========

  /**
   * Estimate document size before saving
   *
   * Calculates the estimated file size of the document without actually saving it.
   * Useful for validating documents before save operations or checking size limits.
   *
   * @async
   * @param {Document} doc - Document to estimate
   * @returns {Promise<ProcessorResult<{totalEstimatedMB: number, warning?: string}>>} Result with size estimate or error
   *
   * @group Document Statistics
   */
  async estimateSize(doc: Document): Promise<
    ProcessorResult<{
      totalEstimatedMB: number;
      warning?: string;
    }>
  > {
    try {
      const sizeEstimate = doc.estimateSize();

      return {
        success: true,
        data: sizeEstimate,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to estimate size: ${error.message}`,
      };
    }
  }

  /**
   * Create a new blank document
   *
   * Creates an empty document with default settings and styles.
   * Always call dispose() on the returned Document when finished.
   *
   * @returns {Document} New blank Document instance
   *
   * @group Utilities
   */
  createNewDocument(): Document {
    return Document.create();
  }

  // ========== Hyperlink Operations ==========

  /**
   * Extract all hyperlinks from a document
   *
   * **CRITICAL METHOD - DO NOT REMOVE**
   * This method is required by WordDocumentProcessor for hyperlink processing operations.
   * It extracts all hyperlinks from the document along with their context (paragraph, URL, text).
   *
   * The returned text is automatically sanitized using sanitizeHyperlinkText() to prevent
   * XML parsing issues and ensure consistent formatting.
   *
   * @async
   * @param {Document} doc - Document to extract hyperlinks from
   * @returns {Promise<Array>} Array of hyperlink objects with structure:
   *   - hyperlink: The Hyperlink instance from docxmlater
   *   - paragraph: The Paragraph containing this hyperlink
   *   - paragraphIndex: Index of the paragraph in the document
   *   - url: The hyperlink URL (or undefined if internal/anchor)
   *   - text: Sanitized display text of the hyperlink
   *
   * @group Hyperlink Operations
   *
   * @example
   * ```typescript
   * const processor = new DocXMLaterProcessor();
   * const doc = await Document.load('document.docx');
   *
   * const hyperlinks = await processor.extractHyperlinks(doc);
   * console.log(`Found ${hyperlinks.length} hyperlinks`);
   *
   * for (const link of hyperlinks) {
   *   console.log(`Text: "${link.text}", URL: ${link.url}`);
   *   console.log(`Located in paragraph ${link.paragraphIndex}`);
   * }
   * ```
   *
   * @see {@link WordDocumentProcessor} - Uses this method for document processing
   */
  async extractHyperlinks(doc: Document): Promise<
    Array<{
      hyperlink: Hyperlink;
      paragraph: Paragraph;
      paragraphIndex: number;
      hyperlinkIndexInParagraph: number; // Index of this hyperlink within its paragraph
      url?: string;
      text: string;
    }>
  > {
    log.debug('Extracting hyperlinks from document');
    // Dynamic import to avoid formatter issues with unused imports
    const { sanitizeHyperlinkText } = await import('@/utils/textSanitizer');

    const hyperlinks: Array<{
      hyperlink: Hyperlink;
      paragraph: Paragraph;
      paragraphIndex: number;
      hyperlinkIndexInParagraph: number;
      url?: string;
      text: string;
    }> = [];

    // Get all paragraphs from the document
    const paragraphs = doc.getAllParagraphs();
    log.debug('Scanning paragraphs for hyperlinks', { paragraphCount: paragraphs.length });

    // Iterate through each paragraph to find hyperlinks
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];

      // Get the content of the paragraph (can include Runs, Hyperlinks, Images, etc.)
      const content = para.getContent();

      // Track hyperlink index within this paragraph
      let hyperlinkIndexInParagraph = 0;

      // Helper function to extract URL from a hyperlink item
      const extractUrlFromHyperlink = (hyperlinkItem: Hyperlink): string | undefined => {
        let url = hyperlinkItem.getUrl();

        // If getUrl() returns undefined, try fallback via relationship ID
        // This handles file-type hyperlinks where the URL is stored in the relationship
        if (!url) {
          const relationshipId = hyperlinkItem.getRelationshipId?.();
          if (relationshipId) {
            // Log that URL couldn't be retrieved via primary API
            // The caller may need to resolve the relationship externally
            log.debug('URL not available via getUrl(), relationship lookup may be needed', {
              relationshipId,
            });
          }
        }

        return url;
      };

      // Helper function to add a hyperlink to the results
      const addHyperlink = (hyperlinkItem: Hyperlink, isInsideRevision: boolean = false) => {
        const url = extractUrlFromHyperlink(hyperlinkItem);
        const rawText = hyperlinkItem.getText() || '';
        const sanitizedText = sanitizeHyperlinkText(rawText);

        hyperlinks.push({
          hyperlink: hyperlinkItem,
          paragraph: para,
          paragraphIndex: i,
          hyperlinkIndexInParagraph,
          url: url,
          text: sanitizedText,
        });

        hyperlinkIndexInParagraph++;

        if (isInsideRevision) {
          log.debug('Found hyperlink inside revision element', { text: sanitizedText.substring(0, 50) });
        }
      };

      // Check each content item for hyperlinks using proper type guards
      for (const item of content) {
        // Case 1: Direct Hyperlink instances
        if (isHyperlink(item)) {
          addHyperlink(item, false);
        }
        // Case 2: Hyperlinks inside Revision elements (w:ins, w:del tracked changes)
        else if (isRevision(item)) {
          const revisionContent = item.getContent();
          for (const innerItem of revisionContent) {
            // Check if the inner item is a Hyperlink using type guard
            if (isHyperlinkContent(innerItem)) {
              addHyperlink(innerItem, true);
            }
          }
        }
      }
    }

    // Log summary with type breakdown
    const internalLinks = hyperlinks.filter((h) => !h.url).length;
    const externalLinks = hyperlinks.filter((h) => h.url).length;
    log.info('Hyperlinks extracted', {
      total: hyperlinks.length,
      external: externalLinks,
      internal: internalLinks,
    });

    return hyperlinks;
  }
}
