import { Document } from 'docxmlater';
import { ProcessorResult } from './types/docx-processing';

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
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.load(filePath, { strictParsing: false });
      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
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
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.loadFromBuffer(buffer);
      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to load document from buffer: ${error.message}`,
      };
    }
  }

  async saveToFile(doc: Document, filePath: string): Promise<ProcessorResult<void>> {
    try {
      await doc.save(filePath);
      return {
        success: true,
      };
    } catch (error: any) {
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
      hyperlink: any; // Hyperlink type from docxmlater
      paragraph: any; // Paragraph type from docxmlater
      paragraphIndex: number;
      url?: string;
      text: string;
    }>
  > {
    // Dynamic import to avoid formatter issues with unused imports
    const { sanitizeHyperlinkText } = await import('@/utils/textSanitizer');

    const hyperlinks: Array<{
      hyperlink: any;
      paragraph: any;
      paragraphIndex: number;
      url?: string;
      text: string;
    }> = [];

    // Get all paragraphs from the document
    const paragraphs = doc.getAllParagraphs();

    // Iterate through each paragraph to find hyperlinks
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];

      // Get the content of the paragraph (can include Runs, Hyperlinks, Images, etc.)
      const content = para.getContent();

      // Check each content item for hyperlinks
      for (const item of content) {
        // Check if the item is a Hyperlink instance
        // We use duck-typing here since we can't import the Hyperlink type without formatter removing it
        if (item && typeof (item as any).getUrl === 'function') {
          // This is a hyperlink - extract its data
          const url = (item as any).getUrl?.();
          const rawText = (item as any).getText?.() || '';

          // Sanitize the text to prevent XML issues
          const sanitizedText = sanitizeHyperlinkText(rawText);

          hyperlinks.push({
            hyperlink: item,
            paragraph: para,
            paragraphIndex: i,
            url: url,
            text: sanitizedText,
          });
        }
      }
    }

    return hyperlinks;
  }
}
