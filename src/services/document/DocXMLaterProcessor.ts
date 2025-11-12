/**
 * DocXMLaterProcessor - DOCX processing using the docxmlater library
 *
 * This processor handles:
 * - Style creation and application (works!)
 * - Table creation with borders and shading (works!)
 * - Paragraph indentation and formatting (works!)
 * - Document reading and writing
 *
 * Replaces the broken docxml/jszip implementation
 */

import {
  Document,
  Paragraph,
  Run,
  Table,
  TableRow,
  TableCell,
  Style,
  StylesManager,
  BorderStyle,
  Hyperlink,
  inchesToTwips,
  twipsToPoints,
  pointsToTwips,
} from 'docxmlater';
import { promises as fs } from 'fs';
import { sanitizeHyperlinkText } from '@/utils/textSanitizer';
import {
  DocumentReadResult,
  DocumentModifyResult,
  ProcessorResult,
  TextStyle,
  ParagraphStyle,
  StyleApplication,
  StyleApplicationResult,
  DocxDocument,
  ErrorCode,
  DocxProcessingError,
} from './types/docx-processing';

export interface DocXMLaterOptions {
  preserveFormatting?: boolean;
  validateOutput?: boolean;
}

/**
 * Main processor class using docxmlater library
 */
export class DocXMLaterProcessor {
  private defaultOptions: DocXMLaterOptions = {
    preserveFormatting: true,
    validateOutput: false,
  };

  constructor(options: DocXMLaterOptions = {}) {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  // ========== Document I/O Operations ==========

  /**
   * Load a DOCX document from file path
   */
  async loadFromFile(filePath: string): Promise<ProcessorResult<Document>> {
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.load(filePath);
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
   * Load a DOCX document from buffer
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

  /**
   * Save document to file
   */
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
   * Convert document to buffer
   */
  async toBuffer(doc: Document): Promise<DocumentModifyResult> {
    try {
      const buffer = await doc.toBuffer();
      return {
        success: true,
        data: buffer,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to convert document to buffer: ${error.message}`,
      };
    }
  }

  // ========== Style Operations ==========

  /**
   * Create a new document with a custom style
   */
  async createDocumentWithStyle(
    styleId: string,
    styleName: string,
    properties: TextStyle & ParagraphStyle
  ): Promise<ProcessorResult<Document>> {
    try {
      const doc = Document.create();

      // Create custom style
      const style = Style.create({
        styleId,
        name: styleName,
        type: 'paragraph',
        basedOn: 'Normal',
        runFormatting: {
          bold: properties.preserveBold ? undefined : properties.bold,
          italic: properties.preserveItalic ? undefined : properties.italic,
          underline: properties.preserveUnderline ? undefined : (properties.underline ? 'single' : undefined),
          font: properties.fontFamily,
          size: properties.fontSize,
          color: properties.color?.replace('#', ''),
        },
        paragraphFormatting: {
          alignment: properties.alignment,
          indentation: {
            left: properties.indentLeft,
            right: properties.indentRight,
            firstLine: properties.indentFirstLine,
          },
          spacing: {
            before: properties.spaceBefore,
            after: properties.spaceAfter,
            line: properties.lineSpacing,
          },
          keepNext: properties.keepNext,
          keepLines: properties.keepLines,
        },
      });

      doc.addStyle(style);

      return {
        success: true,
        data: doc,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to create style: ${error.message}`,
      };
    }
  }

  /**
   * Apply a style to paragraphs in an existing document
   */
  async applyStyleToParagraphs(
    doc: Document,
    styleId: string,
    application: StyleApplication
  ): Promise<ProcessorResult<StyleApplicationResult>> {
    try {
      const paragraphs = doc.getParagraphs();
      let appliedCount = 0;
      let skippedCount = 0;
      const paragraphsModified: number[] = [];

      paragraphs.forEach((para, index) => {
        let shouldApply = false;

        switch (application.target) {
          case 'all':
            shouldApply = true;
            break;

          case 'pattern':
            if (application.pattern) {
              const text = this.getParagraphText(para);
              if (typeof application.pattern === 'string') {
                shouldApply = text.includes(application.pattern);
              } else {
                shouldApply = application.pattern.test(text);
              }
            }
            break;

          case 'indices':
            if (application.indices) {
              shouldApply = application.indices.includes(index);
            }
            break;
        }

        if (shouldApply) {
          para.setStyle(styleId);
          appliedCount++;
          paragraphsModified.push(index);
        } else {
          skippedCount++;
        }
      });

      return {
        success: true,
        data: {
          appliedCount,
          skippedCount,
          paragraphsModified,
          totalParagraphs: paragraphs.length,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to apply style: ${error.message}`,
      };
    }
  }

  /**
   * Helper: Get text content from paragraph
   */
  private getParagraphText(para: any): string {
    try {
      // Access the runs and extract text
      const runs = para.getRuns();
      return runs.map((run: any) => run.getText() || '').join('');
    } catch {
      return '';
    }
  }

  // ========== Table Operations ==========

  /**
   * Create a table with formatting
   */
  async createTable(
    doc: Document,
    rows: number,
    columns: number,
    options: {
      borders?: boolean;
      borderColor?: string;
      borderSize?: number;
      headerShading?: string;
      cellPadding?: number;
    } = {}
  ): Promise<ProcessorResult<Table>> {
    try {
      const table = doc.createTable(rows, columns);

      // Apply borders if requested
      if (options.borders !== false) {
        table.setAllBorders({
          style: 'single' as BorderStyle,
          size: options.borderSize || 4,
          color: options.borderColor || '000000',
        });
      }

      // Apply header shading if provided
      if (options.headerShading && rows > 0) {
        const headerRow = table.getRow(0);
        if (headerRow) {
          for (let col = 0; col < columns; col++) {
            const cell = headerRow.getCell(col);
            if (cell) {
              cell.setShading({
                fill: options.headerShading.replace('#', ''),
              });
            }
          }
        }
      }

      return {
        success: true,
        data: table,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to create table: ${error.message}`,
      };
    }
  }

  /**
   * Set cell shading in a table
   */
  async setCellShading(cell: TableCell, color: string): Promise<ProcessorResult<void>> {
    try {
      cell.setShading({
        fill: color.replace('#', ''),
      });
      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to set cell shading: ${error.message}`,
      };
    }
  }

  /**
   * Add content to a table cell
   */
  async addCellContent(
    cell: TableCell,
    text: string,
    formatting?: TextStyle
  ): Promise<ProcessorResult<void>> {
    try {
      const para = cell.createParagraph(text);

      if (formatting) {
        // Apply text formatting to runs
        const runs = para.getRuns?.() || [];
        runs.forEach((run: any) => {
          if (formatting.bold) run.setBold?.(true);
          if (formatting.italic) run.setItalic?.(true);
          if (formatting.color) run.setColor?.(formatting.color.replace('#', ''));
          if (formatting.fontSize) run.setSize?.(formatting.fontSize);
        });
      }

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to add cell content: ${error.message}`,
      };
    }
  }

  // ========== Paragraph Formatting Operations ==========

  /**
   * Create a paragraph with formatting
   */
  async createParagraph(
    doc: Document,
    text: string,
    formatting?: ParagraphStyle & TextStyle
  ): Promise<ProcessorResult<Paragraph>> {
    try {
      const para = doc.createParagraph(text);

      if (formatting) {
        // Apply paragraph formatting
        if (formatting.alignment) {
          para.setAlignment(formatting.alignment);
        }
        if (formatting.indentLeft !== undefined) {
          para.setLeftIndent(formatting.indentLeft);
        }
        if (formatting.indentRight !== undefined) {
          para.setRightIndent(formatting.indentRight);
        }
        if (formatting.spaceBefore !== undefined) {
          para.setSpaceBefore(formatting.spaceBefore);
        }
        if (formatting.spaceAfter !== undefined) {
          para.setSpaceAfter(formatting.spaceAfter);
        }
        if (formatting.lineSpacing !== undefined) {
          para.setLineSpacing(formatting.lineSpacing);
        }
        if (formatting.keepNext) {
          para.setKeepNext();
        }
        if (formatting.keepLines) {
          para.setKeepLines();
        }

        // Apply text formatting to runs
        const runs = para.getRuns?.() || [];
        runs.forEach((run: any) => {
          if (formatting.bold) run.setBold?.(true);
          if (formatting.italic) run.setItalic?.(true);
          if (formatting.underline) run.setUnderline?.('single');
          if (formatting.color) run.setColor?.(formatting.color.replace('#', ''));
          if (formatting.fontSize) run.setSize?.(formatting.fontSize);
          if (formatting.fontFamily) run.setFont?.(formatting.fontFamily);
        });
      }

      return {
        success: true,
        data: para,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to create paragraph: ${error.message}`,
      };
    }
  }

  /**
   * Set indentation on existing paragraph
   */
  async setIndentation(
    para: Paragraph,
    options: {
      left?: number;
      right?: number;
      firstLine?: number;
    }
  ): Promise<ProcessorResult<void>> {
    try {
      if (options.left !== undefined) {
        para.setLeftIndent(options.left);
      }
      if (options.right !== undefined) {
        para.setRightIndent(options.right);
      }
      if (options.firstLine !== undefined) {
        para.setFirstLineIndent(options.firstLine);
      }

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to set indentation: ${error.message}`,
      };
    }
  }

  // ========== High-Level Document Operations ==========

  /**
   * Read an existing document and extract its structure
   */
  async readDocument(filePath: string): Promise<DocumentReadResult> {
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.load(filePath);

      // Extract document structure
      const paragraphs = doc.getParagraphs();
      const tables = doc.getTables();

      const docStructure: DocxDocument = {
        styles: {
          paragraphStyles: new Map(),
          characterStyles: new Map(),
        },
        numbering: {
          abstractNumberings: new Map(),
          numberingInstances: new Map(),
        },
        fonts: {
          fonts: new Map(),
        },
        content: {
          paragraphs: paragraphs.map((para) => ({
            text: this.getParagraphText(para),
            style: para.getFormatting().style || undefined,
          })),
          tables: tables.map((table) => ({
            rows: table.getRows().map((row) => ({
              cells: row.getCells().map((cell) => {
                const formatting = cell.getFormatting();
                return {
                  text: cell.getText(),
                  colspan: formatting.columnSpan || 1,
                  rowspan: formatting.rowSpan || 1,
                  paragraphs: cell.getParagraphs().map((para) => ({
                    text: this.getParagraphText(para),
                    style: para.getFormatting().style || undefined,
                  })),
                };
              }),
            })),
          })),
        },
      };

      return {
        success: true,
        data: docStructure,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read document: ${error.message}`,
      };
    }
  }

  /**
   * Modify an existing document at file path
   */
  async modifyDocument(
    filePath: string,
    modifications: (doc: Document) => Promise<void> | void
  ): Promise<DocumentModifyResult> {
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.load(filePath);

      // Apply modifications
      await modifications(doc);

      // Save back to buffer
      const buffer = await doc.toBuffer();

      // Overwrite original file
      await fs.writeFile(filePath, buffer);

      return {
        success: true,
        data: buffer,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to modify document: ${error.message}`,
      };
    }
  }

  /**
   * Modify document from buffer
   */
  async modifyDocumentBuffer(
    buffer: Buffer,
    modifications: (doc: Document) => Promise<void> | void
  ): Promise<DocumentModifyResult> {
    try {
      // Use framework defaults to ensure no corruption
      const doc = await Document.loadFromBuffer(buffer);

      // Apply modifications
      await modifications(doc);

      // Convert back to buffer
      const resultBuffer = await doc.toBuffer();

      return {
        success: true,
        data: resultBuffer,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to modify document buffer: ${error.message}`,
      };
    }
  }

  // ========== Hyperlink Operations ==========

  /**
   * Sanitize hyperlink text to remove XML markup corruption
   * CRITICAL: Prevents XML tags from docxmlater getText() from entering the system
   *
   * This addresses the bug where <w:t xml:space="preserve"> appears in document text.
   * The docxmlater library's getText() can return XML markup when the underlying
   * Run object contains corrupted data.
   */

  /**
   * Extract all hyperlinks from a document
   *
   * IMPORTANT: Applies defensive text sanitization to handle potential XML corruption
   * from docxmlater's Hyperlink.getText() method.
   */
  async extractHyperlinks(doc: Document): Promise<
    Array<{
      hyperlink: Hyperlink;
      paragraph: Paragraph;
      paragraphIndex: number;
      url?: string;
      text: string;
    }>
  > {
    const results: Array<{
      hyperlink: Hyperlink;
      paragraph: Paragraph;
      paragraphIndex: number;
      url?: string;
      text: string;
    }> = [];

    const paragraphs = doc.getParagraphs();

    paragraphs.forEach((para, paraIndex) => {
      const content = para.getContent();

      for (const item of content) {
        if (item instanceof Hyperlink) {
          // Extract hyperlink data using docxmlater API
          // Sanitize text to remove any XML corruption that may have been
          // returned by Hyperlink.getText()
          results.push({
            hyperlink: item,
            paragraph: para,
            paragraphIndex: paraIndex,
            url: item.getUrl(),
            text: sanitizeHyperlinkText(item.getText()),
          });
        }
      }
    });

    return results;
  }

  /**
   * Modify hyperlinks in a document based on a transformation function
   * The URL transform function receives the current URL and returns the modified URL
   *
   * IMPORTANT: Applies defensive text sanitization to display text
   */
  async modifyHyperlinks(
    doc: Document,
    urlTransform: (url: string, displayText: string) => string
  ): Promise<
    ProcessorResult<{
      totalHyperlinks: number;
      modifiedHyperlinks: number;
    }>
  > {
    try {
      const paragraphs = doc.getParagraphs();
      let totalHyperlinks = 0;
      let modifiedHyperlinks = 0;

      for (const para of paragraphs) {
        const content = para.getContent();

        for (const item of content) {
          if (item instanceof Hyperlink) {
            totalHyperlinks++;
            const oldUrl = item.getUrl();
            // Sanitize text to remove any XML corruption
            const displayText = sanitizeHyperlinkText(item.getText());

            if (oldUrl) {
              const newUrl = urlTransform(oldUrl, displayText);

              // Modify hyperlink URL in-place (no paragraph reconstruction needed)
              if (newUrl !== oldUrl) {
                item.setUrl(newUrl);
                modifiedHyperlinks++;
              }
            }
          }
        }
      }

      return {
        success: true,
        data: {
          totalHyperlinks,
          modifiedHyperlinks,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to modify hyperlinks: ${error.message}`,
      };
    }
  }

  /**
   * Append Content ID to theSource URLs
   * Pattern matches: [documentid]/docid=[guid] or /Content_ID=[id]
   */
  async appendContentIdToTheSourceUrls(
    filePath: string,
    contentId: string = '#content'
  ): Promise<
    ProcessorResult<{
      totalHyperlinks: number;
      modifiedHyperlinks: number;
    }>
  > {
    try {
      // Load document
      const loadResult = await this.loadFromFile(filePath);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error || 'Failed to load document',
        };
      }

      const doc = loadResult.data;
      const hyperlinks = await this.extractHyperlinks(doc);
      let modifiedCount = 0;

      // Pattern to detect theSource URLs
      const theSourcePattern = /thesource\.caci\.com/i;
      const hasContentIdPattern = /#content$/i;
      const docIdPattern = /docid=([A-Za-z0-9\-]+)/i;

      for (const { hyperlink, url } of hyperlinks) {
        if (!url) continue;

        // Check if it's a theSource URL
        if (theSourcePattern.test(url)) {
          // Check if it already has #content
          if (!hasContentIdPattern.test(url)) {
            // Check if it has a docid parameter
            if (docIdPattern.test(url)) {
              // Append #content
              const newUrl = url + contentId;

              // Create new hyperlink with modified URL
              const newHyperlink = Hyperlink.createExternal(
                newUrl,
                hyperlink.getText(),
                hyperlink.getFormatting()
              );
              modifiedCount++;
            }
          }
        }
      }

      // Save document
      const saveResult = await this.saveToFile(doc, filePath);
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error || 'Failed to save document',
        };
      }

      return {
        success: true,
        data: {
          totalHyperlinks: hyperlinks.length,
          modifiedHyperlinks: modifiedCount,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to append content IDs: ${error.message}`,
      };
    }
  }

  /**
   * Replace hyperlink display text based on a pattern
   *
   * NOTE: extractHyperlinks() already sanitizes text, so this method receives clean text
   */
  async replaceHyperlinkText(
    doc: Document,
    pattern: string | RegExp,
    replacement: string
  ): Promise<ProcessorResult<{ replacedCount: number }>> {
    try {
      const hyperlinks = await this.extractHyperlinks(doc);
      let replacedCount = 0;

      for (const { hyperlink, text: sanitizedText } of hyperlinks) {
        let newText: string;

        if (typeof pattern === 'string') {
          if (sanitizedText.includes(pattern)) {
            newText = sanitizedText.replace(pattern, replacement);
            hyperlink.setText(newText);
            replacedCount++;
          }
        } else {
          if (pattern.test(sanitizedText)) {
            newText = sanitizedText.replace(pattern, replacement);
            hyperlink.setText(newText);
            replacedCount++;
          }
        }
      }

      return {
        success: true,
        data: { replacedCount },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to replace hyperlink text: ${error.message}`,
      };
    }
  }

  // ========== Utility Methods ==========

  /**
   * Create a new blank document
   */
  createNewDocument(): Document {
    return Document.create();
  }

  /**
   * Helper: Convert inches to twips (for indentation)
   */
  inchesToTwips(inches: number): number {
    return inchesToTwips(inches);
  }

  /**
   * Helper: Convert points to twips (for spacing)
   */
  pointsToTwips(points: number): number {
    return pointsToTwips(points);
  }

  /**
   * Helper: Convert twips to points
   */
  twipsToPoints(twips: number): number {
    return twipsToPoints(twips);
  }
}

export default DocXMLaterProcessor;
