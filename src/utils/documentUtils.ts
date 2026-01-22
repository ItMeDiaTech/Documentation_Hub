/**
 * Document Utility Functions for DocXMLater
 *
 * Provides safe wrappers around DocXMLater operations with guaranteed resource cleanup.
 * These utilities ensure documents are always disposed, preventing memory leaks.
 *
 * @module documentUtils
 */

import { Document } from 'docxmlater';

/**
 * Options for document loading
 */
export interface DocumentLoadOptions {
  /** Enable strict XML parsing (default: false for compatibility) */
  strictParsing?: boolean;
  /** How to handle tracked changes: 'preserve' keeps them, 'accept' accepts them */
  revisionHandling?: 'preserve' | 'accept';
  /** Whether to accept all revisions on load (default: false) */
  acceptRevisions?: boolean;
}

/**
 * Execute an operation on a document loaded from file with guaranteed disposal.
 *
 * This function ensures that the document is always disposed, even if the operation
 * throws an error. Use this for any document processing that doesn't need to keep
 * the document open after the operation completes.
 *
 * @template T - The return type of the operation
 * @param filePath - Path to the DOCX file
 * @param operation - Async function that receives the loaded document
 * @param options - Optional loading configuration
 * @returns Promise resolving to the operation result
 *
 * @example
 * ```typescript
 * // Extract all text from a document
 * const text = await withDocumentFromFile('report.docx', async (doc) => {
 *   const paragraphs = doc.getAllParagraphs();
 *   return paragraphs.map(p => p.getText()).join('\n');
 * });
 *
 * // Count hyperlinks in a document
 * const count = await withDocumentFromFile('document.docx', async (doc) => {
 *   const paragraphs = doc.getAllParagraphs();
 *   let hyperlinkCount = 0;
 *   for (const para of paragraphs) {
 *     for (const item of para.getContent()) {
 *       if (typeof item.getUrl === 'function') hyperlinkCount++;
 *     }
 *   }
 *   return hyperlinkCount;
 * });
 * ```
 */
export async function withDocumentFromFile<T>(
  filePath: string,
  operation: (doc: Document) => Promise<T>,
  options?: DocumentLoadOptions
): Promise<T> {
  const doc = await Document.load(filePath, {
    strictParsing: options?.strictParsing ?? false,
    revisionHandling: options?.revisionHandling,
    acceptRevisions: options?.acceptRevisions,
  });

  try {
    return await operation(doc);
  } finally {
    try {
      doc.dispose();
    } catch {
      // Ignore disposal errors - document may already be disposed
    }
  }
}

/**
 * Execute an operation on a document loaded from buffer with guaranteed disposal.
 *
 * Similar to withDocumentFromFile, but loads from a Buffer instead of a file path.
 * Useful for processing documents from HTTP responses, databases, or other in-memory sources.
 *
 * @template T - The return type of the operation
 * @param buffer - Buffer containing the DOCX file data
 * @param operation - Async function that receives the loaded document
 * @returns Promise resolving to the operation result
 *
 * @example
 * ```typescript
 * // Process document from HTTP response
 * const response = await fetch('https://example.com/document.docx');
 * const buffer = Buffer.from(await response.arrayBuffer());
 *
 * const result = await withDocumentFromBuffer(buffer, async (doc) => {
 *   // Process document...
 *   return { pageCount: doc.getParagraphs().length };
 * });
 * ```
 */
export async function withDocumentFromBuffer<T>(
  buffer: Buffer,
  operation: (doc: Document) => Promise<T>
): Promise<T> {
  const doc = await Document.loadFromBuffer(buffer);

  try {
    return await operation(doc);
  } finally {
    try {
      doc.dispose();
    } catch {
      // Ignore disposal errors - document may already be disposed
    }
  }
}

/**
 * Execute an operation on a document and save it with guaranteed disposal.
 *
 * This is a convenience wrapper for the common pattern of loading a document,
 * modifying it, and saving the result. The document is disposed after saving.
 *
 * @template T - The return type of the operation (in addition to saving)
 * @param inputPath - Path to the input DOCX file
 * @param outputPath - Path where the modified document should be saved
 * @param operation - Async function that modifies the document and optionally returns data
 * @param options - Optional loading configuration
 * @returns Promise resolving to the operation result
 *
 * @example
 * ```typescript
 * // Modify document and save
 * await withDocumentModify(
 *   'input.docx',
 *   'output.docx',
 *   async (doc) => {
 *     const paragraphs = doc.getAllParagraphs();
 *     for (const para of paragraphs) {
 *       for (const run of para.getRuns()) {
 *         run.setFont('Arial');
 *       }
 *     }
 *   }
 * );
 * ```
 */
export async function withDocumentModify<T = void>(
  inputPath: string,
  outputPath: string,
  operation: (doc: Document) => Promise<T>,
  options?: DocumentLoadOptions
): Promise<T> {
  const doc = await Document.load(inputPath, {
    strictParsing: options?.strictParsing ?? false,
    revisionHandling: options?.revisionHandling,
    acceptRevisions: options?.acceptRevisions,
  });

  try {
    const result = await operation(doc);
    await doc.save(outputPath);
    return result;
  } finally {
    try {
      doc.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
}

/**
 * Safely dispose a document, catching any errors.
 *
 * Use this when you need to manually dispose a document and want to ensure
 * no exceptions are thrown, even if the document is already disposed or invalid.
 *
 * @param doc - The document to dispose, or null/undefined
 *
 * @example
 * ```typescript
 * let doc: Document | null = null;
 * try {
 *   doc = await Document.load('file.docx');
 *   // ... operations ...
 * } finally {
 *   safeDispose(doc);
 * }
 * ```
 */
export function safeDispose(doc: Document | null | undefined): void {
  if (doc) {
    try {
      doc.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
}
